import { read, uid, write } from "./store.js";
import { email, required, sanitize } from "./validation.js";

export function currentUser() {
  return read("session");
}

export function saveDemoUser(input, mode = "guest") {
  const user = {
    id: input.id || uid(mode === "guest" ? "guest" : "cus"),
    type: mode,
    name: sanitize(input.name),
    email: sanitize(input.email),
    phone: sanitize(input.phone),
    rewards: Boolean(input.rewards),
    createdAt: input.createdAt || new Date().toISOString(),
  };
  write("session", user);
  return user;
}

export function validateAccount(input, { requirePassword = false, requireTerms = false } = {}) {
  const errors = {};
  if (!required(input.name)) errors.name = "Name is required";
  if (!email(input.email)) errors.email = "Enter a valid email";
  if (!required(input.phone)) errors.phone = "Mobile number is required";
  if (requirePassword && String(input.password || "").length < 6) errors.password = "Use at least 6 characters";
  if (requireTerms && !input.terms) errors.terms = "Please accept terms and privacy";
  return errors;
}
