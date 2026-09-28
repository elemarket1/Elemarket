import { pushRegistrationProvider } from "@/routes/push.functions";
const clients: Record<string, () => Promise<unknown>> = {
  fcm: async () => (await import("./fcm.client")).enableFcmPush(),
};
export async function enablePush() {
  const key = await pushRegistrationProvider();
  if (!Object.hasOwn(clients, key)) throw new Error("Push notifications are unavailable");
  return clients[key]();
}
