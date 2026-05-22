import { money, read } from "./store.js";
import { sanitize } from "./validation.js";

export const RESTAURANT_LOCATION = {
  latitude: 52.52,
  longitude: 13.405,
  formattedAddress: "Giros King, 24 Market Street",
};

const DELIVERY_BANDS = [
  { maxKm: 2, fee: 2.99, eta: "22-30 min", label: "0-2 km" },
  { maxKm: 5, fee: 4.99, eta: "30-42 min", label: "2-5 km" },
  { maxKm: 8, fee: 7.99, eta: "42-55 min", label: "5-8 km" },
];

let googleMapsPromise = null;

export function googleMapsApiKey() {
  return typeof window !== "undefined" ? window.GOOGLE_MAPS_API_KEY || "" : "";
}

export function hasGoogleMapsApiKey() {
  return Boolean(googleMapsApiKey());
}

export function restaurantLocation() {
  const settings = read("settings");
  const configured = settings.restaurantLocation || {};
  return {
    latitude: Number(configured.latitude || RESTAURANT_LOCATION.latitude),
    longitude: Number(configured.longitude || RESTAURANT_LOCATION.longitude),
    formattedAddress: settings.address || RESTAURANT_LOCATION.formattedAddress,
  };
}

export function loadGoogleMaps() {
  if (!hasGoogleMapsApiKey()) return Promise.resolve(null);
  if (window.google?.maps?.places) return Promise.resolve(window.google);
  if (googleMapsPromise) return googleMapsPromise;

  googleMapsPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector("[data-google-maps-script]");
    if (existing) {
      existing.addEventListener("load", () => resolve(window.google), { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }

    const script = document.createElement("script");
    const params = new URLSearchParams({
      key: googleMapsApiKey(),
      libraries: "places",
      v: "weekly",
    });
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.defer = true;
    script.dataset.googleMapsScript = "true";
    script.onload = () => resolve(window.google);
    script.onerror = () => reject(new Error("Google Maps could not be loaded"));
    document.head.appendChild(script);
  }).catch(() => null);

  return googleMapsPromise;
}

export async function attachPlacesAutocomplete(input, onSelect) {
  const google = await loadGoogleMaps();
  if (!google?.maps?.places || !input) return null;

  const base = restaurantLocation();
  const center = { lat: base.latitude, lng: base.longitude };
  const options = {
    bounds: {
      north: center.lat + 0.09,
      south: center.lat - 0.09,
      east: center.lng + 0.14,
      west: center.lng - 0.14,
    },
    fields: ["address_components", "formatted_address", "geometry", "place_id", "name"],
    strictBounds: false,
    types: ["address"],
  };

  const autocomplete = new google.maps.places.Autocomplete(input, options);
  autocomplete.addListener("place_changed", () => {
    const address = parseGooglePlace(autocomplete.getPlace());
    if (address) onSelect(address);
  });
  return autocomplete;
}

export function parseGooglePlace(place) {
  if (!place?.geometry?.location) return null;
  const components = {};
  (place.address_components || []).forEach((component) => {
    component.types.forEach((type) => {
      components[type] = component;
    });
  });

  const street = components.route?.long_name || components.route?.short_name || "";
  const houseNumber = components.street_number?.long_name || "";
  const city =
    components.locality?.long_name ||
    components.postal_town?.long_name ||
    components.administrative_area_level_2?.long_name ||
    "";
  const postcode = components.postal_code?.long_name || "";
  const country = components.country?.long_name || "";

  return normalizeAddress({
    source: "google",
    placeId: place.place_id || "",
    formattedAddress: place.formatted_address || [street, houseNumber, postcode, city].filter(Boolean).join(" "),
    street,
    houseNumber,
    city,
    postcode,
    country,
    latitude: Number(place.geometry.location.lat()),
    longitude: Number(place.geometry.location.lng()),
  });
}

export function createManualAddress(value) {
  const input = sanitize(value);
  const postcode = input.match(/\b\d{5}\b/)?.[0] || "";
  const houseNumber = input.match(/\b\d+[a-zA-Z]?\b/)?.[0] || "";
  const street = input
    .replace(postcode, "")
    .replace(new RegExp(`\\b${houseNumber}\\b`), "")
    .replace(/\s+/g, " ")
    .trim();
  const distance = demoDistanceForAddress(input, postcode);
  const base = restaurantLocation();
  const latitude = base.latitude + distance / 111.32;

  return normalizeAddress({
    source: "manual-demo",
    formattedAddress: input,
    street,
    houseNumber,
    city: "Berlin",
    postcode,
    country: "Germany",
    latitude,
    longitude: base.longitude,
  });
}

function demoDistanceForAddress(value, postcode) {
  const text = value.toLowerCase();
  if (text.includes("outside") || postcode.startsWith("99")) return 9.4;
  if (text.includes("outer") || text.includes("ring") || postcode.startsWith("11")) return 6.2;
  if (text.includes("midtown") || postcode.startsWith("10")) return 3.4;
  return 1.2;
}

function normalizeAddress(address) {
  return {
    formattedAddress: sanitize(address.formattedAddress),
    street: sanitize(address.street),
    houseNumber: sanitize(address.houseNumber),
    city: sanitize(address.city),
    postcode: sanitize(address.postcode),
    country: sanitize(address.country),
    latitude: Number(address.latitude || 0),
    longitude: Number(address.longitude || 0),
    placeId: sanitize(address.placeId),
    source: address.source || "manual-demo",
  };
}

export function quoteDelivery(address, subtotal = 0) {
  const normalized = typeof address === "string" ? createManualAddress(address) : address;
  if (!normalized?.latitude || !normalized?.longitude) {
    return unavailableQuote();
  }

  const distanceKm = roundDistance(distanceKmBetween(restaurantLocation(), normalized));
  const band = DELIVERY_BANDS.find((item) => distanceKm <= item.maxKm);
  if (!band) return unavailableQuote(distanceKm);

  return {
    available: true,
    fee: Number(band.fee),
    eta: band.eta,
    area: band.label,
    distanceKm,
    message: `${distanceKm.toFixed(1)} km away · delivery fee ${money(band.fee)}`,
  };
}

function unavailableQuote(distanceKm = null) {
  return {
    available: false,
    fee: 0,
    eta: "",
    area: "Outside range",
    distanceKm,
    message: "Sorry, we do not deliver to this address yet.",
  };
}

function distanceKmBetween(origin, destination) {
  const toRad = (value) => (Number(value) * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const deltaLat = toRad(destination.latitude - origin.latitude);
  const deltaLng = toRad(destination.longitude - origin.longitude);
  const lat1 = toRad(origin.latitude);
  const lat2 = toRad(destination.latitude);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function roundDistance(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

export function mapPreviewUrl(address) {
  if (!hasGoogleMapsApiKey() || !address?.latitude || !address?.longitude) return "";
  const marker = `${address.latitude},${address.longitude}`;
  const params = new URLSearchParams({
    center: marker,
    zoom: "15",
    size: "640x240",
    scale: "2",
    markers: `color:blue|${marker}`,
    key: googleMapsApiKey(),
  });
  return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
}
