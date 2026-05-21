export async function createOrder(order) {
  const response = await fetch("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ order }),
  });
  if (!response.ok) throw new Error("Order could not be submitted");
  return response.json();
}

export async function changeOrderStatus(order, status) {
  const response = await fetch(`/api/orders/${encodeURIComponent(order.id)}/status`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Token": window.GIROS_ADMIN_TOKEN || "dev-admin-token",
    },
    body: JSON.stringify({ order, status }),
  });
  if (!response.ok) throw new Error("Order status could not be updated");
  return response.json();
}
