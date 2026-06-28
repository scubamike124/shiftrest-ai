// Phase 5 — Smart Home device types.
//
// Devices are registered by the user. Lovable does NOT ship Alexa / Google
// Home / HomeKit OAuth — those vendors require per-app developer programs
// and per-user OAuth, which the user must explicitly authorize. Until that
// is wired, "vendor" is a tag for organization; actual control is via the
// user's existing voice assistant. Our automations issue *intents* (turn on
// bedroom lamp, start the coffee maker) that map to vendor-specific
// commands the user can paste into their own routine app.
//
// Sensitive devices (locks, garage) get an extra confirmation gate.

export type DeviceKind =
  | "light"
  | "plug"
  | "thermostat"
  | "speaker"
  | "coffee_maker"
  | "fan"
  | "tv"
  | "lock"
  | "garage"
  | "blinds"
  | "humidifier"
  | "bedroom"
  | "other";

export type DeviceVendor =
  | "manual"
  | "alexa"
  | "google_home"
  | "homekit"
  | "smartthings"
  | "home_assistant"
  | "matter"
  | "other";

import type { JsonObject } from "../json";

export interface SmartDevice {
  id: string;
  label: string;
  kind: DeviceKind;
  room: string | null;
  vendor: DeviceVendor;
  capabilities: DeviceCapabilities;
  sensitive: boolean;
  enabled: boolean;
  metadata: JsonObject;
  createdAt: string;
  updatedAt: string;
}

export interface DeviceCapabilities {
  onOff?: boolean;
  brightness?: boolean;
  colorTemp?: boolean;
  color?: boolean;
  setpoint?: boolean;
  fanSpeed?: boolean;
  volume?: boolean;
}

export const SENSITIVE_KINDS: ReadonlySet<DeviceKind> = new Set(["lock", "garage"]);

export const DEVICE_KIND_LABELS: Record<DeviceKind, string> = {
  light: "Smart Light",
  plug: "Smart Plug",
  thermostat: "Thermostat",
  speaker: "Smart Speaker",
  coffee_maker: "Coffee Maker",
  fan: "Fan",
  tv: "TV",
  lock: "Smart Lock",
  garage: "Garage Door",
  blinds: "Blinds",
  humidifier: "Humidifier",
  bedroom: "Bedroom Device",
  other: "Other",
};

export const DEVICE_VENDOR_LABELS: Record<DeviceVendor, string> = {
  manual: "Manual",
  alexa: "Amazon Alexa",
  google_home: "Google Home",
  homekit: "Apple HomeKit",
  smartthings: "SmartThings",
  home_assistant: "Home Assistant",
  matter: "Matter",
  other: "Other",
};

export function defaultCapabilitiesForKind(kind: DeviceKind): DeviceCapabilities {
  switch (kind) {
    case "light":
      return { onOff: true, brightness: true, colorTemp: true };
    case "plug":
    case "coffee_maker":
    case "humidifier":
    case "tv":
    case "bedroom":
    case "other":
      return { onOff: true };
    case "thermostat":
      return { onOff: true, setpoint: true };
    case "fan":
      return { onOff: true, fanSpeed: true };
    case "speaker":
      return { onOff: true, volume: true };
    case "blinds":
      return { onOff: true };
    case "lock":
    case "garage":
      return { onOff: true };
  }
}
