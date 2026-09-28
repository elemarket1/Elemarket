-- Provider-neutral payment architecture: settlement-control is not a payment-driver capability.
-- The delivery + 24h/no-dispute rule is enforced by ELEMARKET's merchant-withdrawal gate.
alter table payment_driver_capabilities drop column if exists delivery_dispute_hold;
