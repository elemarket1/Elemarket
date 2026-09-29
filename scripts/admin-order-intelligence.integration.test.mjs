import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomInt } from "node:crypto";
import { Pool } from "pg";
import { loadTypeScript, serverFunctionStub } from "./helpers/load-typescript.mjs";
import { createPaymentFixture } from "./helpers/payment-fixture.mjs";
const enabled =
  process.env.RUN_DB_INTEGRATION === "1" && !!process.env.ELEMARKET_INTEGRATION_DATABASE_URL;
const pool = enabled
  ? new Pool({ connectionString: process.env.ELEMARKET_INTEGRATION_DATABASE_URL })
  : null;
after(() => pool?.end());
const query = async (s, p) => (await pool.query(s, p)).rows;
const schemas = loadTypeScript("src/lib/admin/orders.schemas.ts");
const db = { getSql: async () => ({ query }) };
const model = loadTypeScript("src/lib/admin/orders.server.ts", { "@/lib/db": db });
const noLimit = { enforceRateLimit: async () => {} };
function integration(name, fn) {
  test(name, { skip: !enabled ? "Disposable PostgreSQL required" : false }, fn);
}
async function principal(role = "admin", { mfa = true, fresh = true } = {}) {
  const id = "ops_" + randomUUID(),
    sid = "session_" + id;
  await query(
    'insert into "user"(id,name,email,"emailVerified",role,"twoFactorEnabled","twoFactorEnabledAt") values($1,\'Operator\',$2,true,$3,true,now()-interval \'1 day\')',
    [id, id + "@integration.test", role],
  );
  await query(
    'insert into session(id,token,"userId","expiresAt","createdAt","updatedAt") values($1,$1,$2,now()+interval \'1 day\',now()-($3::int*interval \'1 hour\'),now())',
    [sid, id, fresh ? 0 : 2],
  );
  if (mfa)
    await query(
      "insert into admin_session_assurance(session_id,user_id,method,verified_at) values($1,$2,'totp',now())",
      [sid, id],
    );
  return { id, sid };
}
function runtime(actor) {
  const request = { getRequest: () => new Request("http://localhost:8080/admin/orders") };
  const auth = {
    api: {
      getSession: async () => {
        if (!actor) return null;
        const s = (await query("select * from session where id=$1", [actor.sid]))[0];
        return { user: { id: actor.id }, session: s };
      },
    },
  };
  const verify = loadTypeScript("src/lib/auth/verify.server.ts", {
    "@tanstack/react-start/server": request,
    "./server": { auth, authConfigured: true, readSessionToken: () => null },
  });
  const authorization = loadTypeScript("src/lib/auth/authorization.server.ts", {
    "./verify.server": verify,
    "@tanstack/react-start/server": request,
    "./server": { auth },
    "../db": db,
  });
  const permissions = loadTypeScript("src/lib/admin/permissions.server.ts", {
    "@/lib/auth/authorization.server": authorization,
    "@/lib/auth/verify.server": verify,
  });
  const middleware = {
    authMiddleware: {},
    getAuthenticatedUserId: (c) => {
      if (!c.userId) throw new Error("Unauthenticated");
      return c.userId;
    },
  };
  const shared = {
    "@tanstack/react-start": { createServerFn: serverFunctionStub },
    "@/lib/auth/middleware": middleware,
    "./permissions.server": permissions,
    "@/lib/admin/permissions.server": permissions,
    "@/lib/db": db,
    "@/lib/security/rate-limit.server": noLimit,
    "./orders.schemas": schemas,
    "@/lib/auth/authorization.server": authorization,
    "@/lib/auth/verify.server": verify,
  };
  const orders = loadTypeScript("src/lib/admin/orders.functions.ts", {
    ...shared,
    "./orders.server": model,
  });
  const support = loadTypeScript("src/lib/admin/support-operations.functions.ts", shared);
  const customer = loadTypeScript("src/lib/support.functions.ts", shared);
  let refunds = 0;
  const dashboard = loadTypeScript("src/routes/admin/dashboard.functions.ts", {
    ...shared,
    "@/lib/market/refunds.server": {
      executeProviderRefundAsAdmin: async (id) => {
        refunds++;
        return { requestId: id, status: "processing" };
      },
    },
  });
  return {
    orders,
    support,
    customer,
    dashboard,
    authorization,
    permissions,
    refunds: () => refunds,
    call: async (fn, data) => fn({ data, context: { userId: actor?.id } }),
  };
}
async function setup(options) {
  const ids = await createPaymentFixture(query);
  const actor = await principal("admin", options);
  const r = runtime(actor);
  return { ids, actor, r };
}
async function paid(ids) {
  await query("select create_payment_attempt($1,$2,100,'GHS','{}')", [ids.payment, ids.provider]);
  await query("update payment_attempts set provider_reference=$1 where payment_id=$2", [
    "ref_" + ids.payment,
    ids.payment,
  ]);
  await query("select apply_payment_webhook($1,$2,'charge.success',$3,'completed',100,'GHS',$4)", [
    ids.provider,
    ids.event,
    "ref_" + ids.payment,
    "f".repeat(64),
  ]);
}
async function open(r, ids) {
  return r.call(r.support.manageAdminSupport, {
    action: "open",
    orderId: ids.order,
    conversationId: null,
    idempotencyKey: randomUUID(),
  });
}
function action(ids, c, action, extra = {}) {
  return { orderId: ids.order, conversationId: c, action, idempotencyKey: randomUUID(), ...extra };
}

integration(
  "admin exact order-number search preserves existing ID and rejects prefix enumeration",
  async () => {
    const { ids, r } = await setup();
    const result = await r.call(r.orders.searchAdminOrders, { query: ids.order });
    assert.equal(result.rows[0].id, ids.order);
    assert.equal(
      (await r.call(r.orders.searchAdminOrders, { query: ids.order.slice(0, -2) })).rows.length,
      0,
    );
  },
);
integration(
  "admin order overview explicitly projects verified masked customer and merchant data",
  async () => {
    const { ids, r } = await setup();
    await query(
      "insert into profiles(user_id,name,phone,phone_verified_at) values($1,'Customer',$2,now())",
      [ids.user, "+23324" + randomInt(100, 999) + "4567"],
    );
    await query("update profiles set phone_verified_at=now() where user_id=$1", [ids.user]);
    const { order, withdrawal } = await r.call(r.orders.getAdminOrder, { orderId: ids.order });
    assert.equal(order.customerId, ids.user);
    assert.equal(order.customerPhone, "***4567");
    assert.match(order.customerEmail, /\*\*\*/);
    assert.equal(order.merchantId, ids.merchant);
    assert.equal(order.merchantName, "Integration Merchant");
    assert.equal(withdrawal.deliveryHoldGuaranteed, false);
    assert.equal(withdrawal.providerSettlementControlled, false);
    assert.ok(order.paymentDeadline);
  },
);
integration(
  "order items include variant SKU price quantity and correct merchant ownership",
  async () => {
    const { ids, r } = await setup();
    const x = await r.call(r.orders.getAdminOrderSection, { orderId: ids.order, section: "items" });
    assert.equal(x.rows[0].variantId, ids.variant);
    assert.equal(x.rows[0].sku, "IT-SKU");
    assert.equal(x.rows[0].merchantId, ids.merchant);
    assert.equal(x.rows[0].quantity, 1);
  },
);
integration(
  "payment section reports owning driver and provider reference without metadata or secrets",
  async () => {
    const { ids, r } = await setup();
    await paid(ids);
    await query(
      "update payment_attempts set metadata='{" +
        '"accessCode":"DO_NOT_EXPOSE","secret":"DO_NOT_EXPOSE"' +
        "}',checkout_url='https://secret.invalid/DO_NOT_EXPOSE',failure_message='DO_NOT_EXPOSE' where payment_id=$1",
      [ids.payment],
    );
    const x = await r.call(r.orders.getAdminOrderSection, {
      orderId: ids.order,
      section: "payments",
    });
    assert.equal(x.rows[0].reference, "ref_" + ids.payment);
    assert.equal(x.rows[0].driver, "http");
    assert.equal(x.rows[0].verifiedEvidence, true);
    assert.ok(x.rows[0].paidAt);
    assert.ok(!JSON.stringify(x).includes("DO_NOT_EXPOSE"));
  },
);
integration(
  "payment reference customer merchant and status filters search only bound orders",
  async () => {
    const { ids, r } = await setup();
    await paid(ids);
    for (const [searchBy, q] of [
      ["payment_reference", "ref_" + ids.payment],
      ["customer", ids.user],
      ["merchant", ids.merchant],
    ])
      assert.equal(
        (
          await r.call(r.orders.searchAdminOrders, {
            searchBy,
            query: q,
            paymentStatus: "completed",
          })
        ).rows[0].id,
        ids.order,
      );
    assert.equal(
      (await r.call(r.orders.searchAdminOrders, { query: ids.order, status: "cancelled" })).rows
        .length,
      0,
    );
  },
);
integration("delivery section and timeline use real persisted shipment events", async () => {
  const { ids, r } = await setup();
  const ship = "sh_" + randomUUID();
  await query(
    "insert into shipments(id,order_id,merchant_id,status,carrier,tracking_number,external_shipment_id) values($1,$2,$3,'in_transit','Fixture carrier','TRACK1','EXT1')",
    [ship, ids.order, ids.merchant],
  );
  await query(
    "insert into shipment_events(id,shipment_id,event_type,event_at,carrier_event_id) values($1,$2,'in_transit',now(),'provider-event1')",
    ["evt_" + ship, ship],
  );
  const delivery = await r.call(r.orders.getAdminOrderSection, {
    orderId: ids.order,
    section: "delivery",
  });
  assert.equal(delivery.rows[0].trackingNumber, "TRACK1");
  const timeline = await r.call(r.orders.getAdminOrderSection, {
    orderId: ids.order,
    section: "timeline",
    pageSize: 50,
  });
  assert.ok(
    timeline.rows.some((e) => e.event_id === "provider-event1" && e.provider_reference === "EXT1"),
  );
  assert.ok(
    timeline.rows.every(
      (e, i, a) => i === 0 || new Date(e.occurred_at) >= new Date(a[i - 1].occurred_at),
    ),
  );
});
integration(
  "dispute and provider refund DTOs are bound to this order and redact provider responses",
  async () => {
    const { ids, r } = await setup();
    await paid(ids);
    const d = (
      await query("select open_customer_order_dispute($1,$2,$3) result", [
        ids.order,
        ids.user,
        "Damaged item received",
      ])
    )[0].result;
    const x = await r.call(r.orders.getAdminOrderSection, {
      orderId: ids.order,
      section: "disputes",
    });
    assert.equal(x.rows[0].id, d.disputeId);
    const prepared = (
      await query("select prepare_provider_refund_for_dispute($1,$2,$3) result", [
        d.disputeId,
        (await principal()).id,
        "Verified claim",
      ])
    )[0].result;
    await query(
      'update provider_refund_requests set provider_response=\'{"token":"DO_NOT_EXPOSE"}\' where id=$1',
      [prepared.requestId],
    );
    const refund = await r.call(r.orders.getAdminOrderSection, {
      orderId: ids.order,
      section: "refunds",
    });
    assert.equal(refund.rows[0].paymentId, ids.payment);
    assert.ok(!JSON.stringify(refund).includes("DO_NOT_EXPOSE"));
  },
);
integration(
  "order timeline reflects persisted status transitions, not frontend assumptions",
  async () => {
    const { ids, r } = await setup();
    await query("update orders set status='cancelled',updated_at=now() where id=$1", [ids.order]);
    const x = await r.call(r.orders.getAdminOrderSection, {
      orderId: ids.order,
      section: "timeline",
      pageSize: 50,
    });
    assert.ok(
      x.rows.some((e) => e.from_status === "payment_pending" && e.to_status === "cancelled"),
    );
    assert.ok(!x.rows.some((e) => e.event_type.includes("withdrawal")));
  },
);
integration("all linked support conversations visible including closed conversations", async () => {
  const { ids, r } = await setup();
  const c = await open(r, ids);
  await r.call(
    r.support.manageAdminSupport,
    action(ids, c.conversationId, "status", { status: "closed" }),
  );
  const next = await open(r, ids);
  assert.notEqual(next.conversationId, c.conversationId);
  const x = await r.call(r.orders.getAdminOrderSection, { orderId: ids.order, section: "support" });
  assert.equal(x.rows.length, 2);
});
integration(
  "support reply is customer visible and internal note never reaches customer API",
  async () => {
    const { ids, r } = await setup();
    const c = await open(r, ids);
    await r.call(
      r.support.manageAdminSupport,
      action(ids, c.conversationId, "reply", { body: "Customer reply" }),
    );
    await r.call(
      r.support.manageAdminSupport,
      action(ids, c.conversationId, "note", { body: "PRIVATE_NOTE_SENTINEL" }),
    );
    const admin = await r.call(r.support.readAdminSupportConversation, {
      orderId: ids.order,
      conversationId: c.conversationId,
    });
    assert.ok(
      admin.messages.some((m) => m.kind === "internal_note" && m.body === "PRIVATE_NOTE_SENTINEL"),
    );
    const customer = runtime({ id: ids.user, sid: "unused" });
    const visible = await customer.call(customer.customer.getSupportConversation, {
      orderId: ids.order,
    });
    assert.ok(visible.messages.some((m) => m.body === "Customer reply"));
    assert.ok(!JSON.stringify(visible).includes("PRIVATE_NOTE_SENTINEL"));
    assert.equal(
      (
        await query("select count(*)::int n from support_messages where body=$1", [
          "PRIVATE_NOTE_SENTINEL",
        ])
      )[0].n,
      0,
    );
  },
);
integration(
  "support operations assign escalate classify close and reopen with audit records",
  async () => {
    const { ids, r, actor } = await setup();
    const c = await open(r, ids);
    for (const [op, values] of [
      ["assign", { assigneeId: actor.id }],
      ["escalate", {}],
      ["classify", { category: "payment", subject: "Payment review" }],
      ["status", { status: "closed" }],
      ["status", { status: "open" }],
    ])
      await r.call(r.support.manageAdminSupport, action(ids, c.conversationId, op, values));
    const x = await r.call(r.support.readAdminSupportConversation, {
      orderId: ids.order,
      conversationId: c.conversationId,
    });
    assert.equal(x.conversation.assignedTo, actor.id);
    assert.ok(x.conversation.escalatedAt);
    assert.equal(x.conversation.status, "open");
    assert.equal(x.conversation.category, "payment");
    assert.equal(
      (
        await query(
          "select count(*)::int n from audit_events where resource_id=$1 and event_type='support.operation'",
          [c.conversationId],
        )
      )[0].n,
      6,
    );
  },
);
integration(
  "duplicate and concurrent support operations create exactly one note and receipt",
  async () => {
    const { ids, r } = await setup();
    const c = await open(r, ids),
      input = action(ids, c.conversationId, "note", { body: "one note" });
    const results = await Promise.all([
      r.call(r.support.manageAdminSupport, input),
      r.call(r.support.manageAdminSupport, input),
      r.call(r.support.manageAdminSupport, input),
    ]);
    assert.deepEqual(results[0], results[1]);
    assert.equal(
      (
        await query("select count(*)::int n from support_staff_notes where conversation_id=$1", [
          c.conversationId,
        ])
      )[0].n,
      1,
    );
    await assert.rejects(
      () => r.call(r.support.manageAdminSupport, { ...input, body: "changed" }),
      /idempotency/,
    );
  },
);
for (const role of ["customer", "merchant"])
  integration(
    `${role} cannot access admin order, payment, support, enumeration or refund endpoints`,
    async () => {
      const { ids } = await setup(),
        r = runtime(await principal(role));
      for (const [fn, data] of [
        [r.orders.searchAdminOrders, { query: ids.order }],
        [r.orders.getAdminOrder, { orderId: ids.order }],
        [r.orders.getAdminOrderSection, { orderId: ids.order, section: "payments" }],
        [r.support.readAdminSupportConversation, { orderId: ids.order, conversationId: "guess" }],
        [r.dashboard.requestAdminProviderRefund, { orderId: ids.order }],
      ])
        await assert.rejects(() => r.call(fn, data), /Forbidden/);
      assert.equal(r.refunds(), 0);
    },
  );
integration("signed-out access fails before any order enumeration", async () => {
  const r = runtime(null);
  await assert.rejects(
    () => r.call(r.orders.searchAdminOrders, { query: "missing" }),
    /Unauthenticated/,
  );
});
integration(
  "admin with enabled 2FA but no verified TOTP session cannot read or mutate",
  async () => {
    const { ids, r } = await setup({ mfa: false });
    for (const [fn, data] of [
      [r.orders.getAdminOrder, { orderId: ids.order }],
      [r.orders.getAdminOrderSection, { orderId: ids.order, section: "refunds" }],
      [
        r.support.manageAdminSupport,
        { action: "open", orderId: ids.order, conversationId: null, idempotencyKey: randomUUID() },
      ],
      [r.dashboard.requestAdminProviderRefund, { orderId: ids.order }],
    ])
      await assert.rejects(() => r.call(fn, data), /verified TOTP/);
  },
);
integration(
  "stale admin session can read but cannot mutate support or request refunds",
  async () => {
    const { ids, r } = await setup({ fresh: false });
    await r.call(r.orders.getAdminOrder, { orderId: ids.order });
    await assert.rejects(() => open(r, ids), /Fresh authentication/);
    await assert.rejects(
      () => r.call(r.dashboard.requestAdminProviderRefund, { orderId: ids.order }),
      /Fresh authentication/,
    );
  },
);
integration(
  "tampered conversation/order pairing denied for read, reply, internal note and linking",
  async () => {
    const { ids, r } = await setup(),
      other = await createPaymentFixture(query);
    const c = await open(r, ids);
    await assert.rejects(
      () =>
        r.call(r.support.readAdminSupportConversation, {
          orderId: other.order,
          conversationId: c.conversationId,
        }),
      /unavailable/,
    );
    for (const op of ["reply", "note", "link"])
      await assert.rejects(
        () =>
          r.call(
            r.support.manageAdminSupport,
            action(other, c.conversationId, op, op === "link" ? {} : { body: "attack" }),
          ),
        /mismatch/,
      );
  },
);
integration("customer cannot read or send to another customer support conversation", async () => {
  const { ids, r } = await setup(),
    other = await createPaymentFixture(query),
    c = await open(r, ids),
    customer = runtime({ id: other.user, sid: "unused" });
  await assert.rejects(
    () => customer.call(customer.customer.getSupportConversation, { orderId: ids.order }),
    /own/,
  );
  await assert.rejects(
    () =>
      customer.call(customer.customer.sendSupportMessage, {
        conversationId: c.conversationId,
        body: "attack",
        idempotencyKey: randomUUID(),
      }),
    /access denied/,
  );
});
integration("mass-assigned payment refund merchant role or actor fields rejected", async () => {
  const { ids, r } = await setup();
  for (const extra of [
    { paymentId: "wrong" },
    { refundId: "wrong" },
    { merchantId: "wrong" },
    { adminId: "wrong" },
    { role: "admin" },
  ]) {
    await assert.rejects(() => r.call(r.orders.getAdminOrder, { orderId: ids.order, ...extra }));
    await assert.rejects(() =>
      r.call(r.dashboard.requestAdminProviderRefund, { orderId: ids.order, ...extra }),
    );
  }
  assert.equal(r.refunds(), 0);
});
integration(
  "SQL injection and arbitrary search expressions rejected or treated as literal identifiers",
  async () => {
    const { r } = await setup();
    for (const query of ["' OR 1=1 --", "%", ".*", "a;drop table orders"])
      await assert.rejects(() => r.call(r.orders.searchAdminOrders, { query }));
    assert.equal(
      (await r.call(r.orders.searchAdminOrders, { query: "not-a-real-order" })).rows.length,
      0,
    );
  },
);
integration("support assignee cannot be a customer or a merchant", async () => {
  const { ids, r } = await setup();
  const c = await open(r, ids);
  await assert.rejects(
    () =>
      r.call(
        r.support.manageAdminSupport,
        action(ids, c.conversationId, "assign", { assigneeId: ids.user }),
      ),
    /administrator/,
  );
});
integration("existing support idempotency key cannot cross conversation boundaries", async () => {
  const { ids, r, actor } = await setup();
  const other = await createPaymentFixture(query),
    a = await open(r, ids),
    b = await open(r, other),
    key = randomUUID();
  await query("select append_support_agent_message($1,$2,$3,$4)", [
    actor.id,
    a.conversationId,
    "Same text",
    key,
  ]);
  await assert.rejects(
    () =>
      query("select append_support_agent_message($1,$2,$3,$4)", [
        actor.id,
        b.conversationId,
        "Same text",
        key,
      ]),
    /idempotency/,
  );
});
integration("support DB constraints reject cross-customer order reassignment", async () => {
  const { ids, r } = await setup(),
    other = await createPaymentFixture(query),
    c = await open(r, ids);
  await assert.rejects(
    () =>
      query("update support_conversations set order_id=$1 where id=$2", [
        other.order,
        c.conversationId,
      ]),
    /immutable/,
  );
  await assert.rejects(
    () =>
      query("insert into support_conversations(id,customer_id,order_id) values($1,$2,$3)", [
        "bad_" + randomUUID(),
        other.user,
        ids.order,
      ]),
    /mismatch/,
  );
});
integration("same-customer general conversation can attach an order exactly once", async () => {
  const { ids, r } = await setup();
  const c = (await query("select create_support_conversation($1,null) id", [ids.user]))[0].id;
  await r.call(r.support.manageAdminSupport, action(ids, c, "link"));
  assert.equal(
    (
      await r.call(r.support.readAdminSupportConversation, {
        conversationId: c,
        orderId: ids.order,
      })
    ).conversation.orderId,
    ids.order,
  );
});
integration("large item lists and support histories paginate without losing rows", async () => {
  const { ids, r } = await setup();
  for (let i = 0; i < 4; i++)
    await query(
      "insert into order_items(order_id,product_id,variant_id,quantity,unit_price,currency,product_total) values($1,$2,$3,1,100,'GHS',100)",
      [ids.order, ids.product, ids.variant],
    );
  const found = [];
  for (let page = 0; page < 3; page++) {
    const x = await r.call(r.orders.getAdminOrderSection, {
      orderId: ids.order,
      section: "items",
      page,
      pageSize: 2,
    });
    found.push(...x.rows.map((i) => i.id));
    assert.equal(x.hasMore, page < 2);
  }
  assert.equal(new Set(found).size, 5);
  const c = await open(r, ids);
  for (let i = 0; i < 5; i++)
    await r.call(
      r.support.manageAdminSupport,
      action(ids, c.conversationId, "note", { body: "note " + i }),
    );
  const a = await r.call(r.support.readAdminSupportConversation, {
    conversationId: c.conversationId,
    orderId: ids.order,
    pageSize: 2,
  });
  const b = await r.call(r.support.readAdminSupportConversation, {
    conversationId: c.conversationId,
    orderId: ids.order,
    pageSize: 2,
    page: 1,
  });
  assert.equal(a.hasMore, true);
  assert.equal(new Set([...a.messages, ...b.messages].map((m) => m.id)).size, 4);
});
integration(
  "safe audit projection excludes arbitrary metadata and read operations are audited",
  async () => {
    const { ids, r } = await setup();
    await query(
      "select record_audit_event('test.secret','order',$1,null,'system',null,'success','{\"token\":\"DO_NOT_EXPOSE\"}')",
      [ids.order],
    );
    await r.call(r.orders.getAdminOrder, { orderId: ids.order });
    const x = await r.call(r.orders.getAdminOrderSection, { orderId: ids.order, section: "audit" });
    assert.ok(x.rows.some((row) => row.event === "admin.order.read"));
    assert.ok(!JSON.stringify(x).includes("DO_NOT_EXPOSE"));
  },
);
integration(
  "every detail section executes against real schema with bounded safe DTOs",
  async () => {
    const { ids, r } = await setup();
    for (const section of schemas.orderSections) {
      const x = await r.call(r.orders.getAdminOrderSection, {
        orderId: ids.order,
        section,
        pageSize: 1,
      });
      assert.ok(x.rows.length <= 1);
      for (const row of x.rows)
        for (const value of Object.values(row))
          assert.ok(
            value === null || ["string", "number", "boolean"].includes(typeof value),
            section,
          );
    }
  },
);
integration("search pagination and date filters are server side and stable", async () => {
  const { ids, r } = await setup();
  const pages = [];
  for (let page = 0; page < 2; page++)
    pages.push(await r.call(r.orders.searchAdminOrders, { page, pageSize: 2 }));
  assert.equal(new Set(pages.flatMap((x) => x.rows.map((r) => r.id))).size, 4);
  assert.equal(
    (await r.call(r.orders.searchAdminOrders, { query: ids.order, to: "2000-01-01T00:00:00.000Z" }))
      .rows.length,
    0,
  );
  await assert.rejects(() =>
    r.call(r.orders.searchAdminOrders, {
      from: "2030-01-01T00:00:00.000Z",
      to: "2000-01-01T00:00:00.000Z",
    }),
  );
});
integration(
  "refund endpoint derives payment and dispute from order instead of client identities",
  async () => {
    const { ids, r } = await setup();
    await paid(ids);
    const result = await r.call(r.dashboard.requestAdminProviderRefund, {
      orderId: ids.order,
      note: "Confirmed cancellation",
    });
    const row = (
      await query("select payment_id,order_id from provider_refund_requests where id=$1", [
        result.requestId,
      ])
    )[0];
    assert.equal(row.payment_id, ids.payment);
    assert.equal(row.order_id, ids.order);
    assert.equal(r.refunds(), 1);
  },
);

integration("provider reference search preserves Paystack equals characters", async () => {
  const { ids, r } = await setup();
  const reference = "PS=transaction-" + ids.payment;
  await query("update payments set provider_reference=$1 where id=$2", [reference, ids.payment]);
  const result = await r.call(r.orders.searchAdminOrders, {
    searchBy: "payment_reference",
    query: reference,
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].id, ids.order);
});
integration("historical payment transitions never inherit a newer attempt reference", async () => {
  const { ids, r } = await setup();
  await paid(ids);
  await query("update payments set provider_reference=$2 where id=$1", [
    ids.payment,
    "newer-reference-" + ids.payment,
  ]);
  const result = await r.call(r.orders.getAdminOrderSection, {
    orderId: ids.order,
    section: "timeline",
    pageSize: 50,
  });
  const event = result.rows.find(
    (e) => e.event_type === "payment.state_changed" && e.event_id === ids.event,
  );
  assert.equal(event.provider_reference, "ref_" + ids.payment);
  const created = result.rows.find((e) => e.event_type === "order.created");
  assert.equal(created.actor_type, "unknown");
  assert.equal(created.actor_id, null);
});
