export function required(value) {
  return String(value || "").trim().length > 0;
}

export function email(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

export function sanitize(value) {
  return String(value || "")
    .replace(/[<>]/g, "")
    .trim();
}

export function validateCheckout(formData, fulfillment) {
  const errors = {};
  if (!required(formData.get("name"))) errors.name = "Name is required";
  if (!email(formData.get("email"))) errors.email = "Enter a valid email";
  if (!required(formData.get("phone"))) errors.phone = "Phone is required";
  if (fulfillment === "delivery" && !required(formData.get("address"))) errors.address = "Delivery address is required";
  return errors;
}
