import { createFileRoute, Outlet, useMatch } from "@tanstack/react-router";
import { CustomerOrders } from "@/components/customer-orders";

export const Route = createFileRoute("/orders")({
  component: OrdersRouteContent,
});

function OrdersRouteContent() {
  const detail = useMatch({ from: "/orders/$id", shouldThrow: false });
  return detail ? <Outlet /> : <CustomerOrders />;
}
