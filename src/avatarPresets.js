export const AVATAR_PRESETS = [
    { id: "duck", label: "Duck", url: "/avatar-presets/duck.svg" },
    { id: "swan", label: "Swan", url: "/avatar-presets/swan.svg" },
    { id: "dolphin", label: "Dolphin", url: "/avatar-presets/dolphin.svg" },
    { id: "whale", label: "Whale", url: "/avatar-presets/whale.svg" },
    { id: "seal", label: "Seal", url: "/avatar-presets/seal.svg" },
    { id: "turtle", label: "Turtle", url: "/avatar-presets/turtle.svg" },
    { id: "fish", label: "Fish", url: "/avatar-presets/fish.svg" },
    { id: "tropical-fish", label: "Tropical Fish", url: "/avatar-presets/tropical-fish.svg" },
    { id: "octopus", label: "Octopus", url: "/avatar-presets/octopus.svg" },
    { id: "crab", label: "Crab", url: "/avatar-presets/crab.svg" },
];

export function isAvatarPresetUrl(value) {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized) return false;
    return AVATAR_PRESETS.some((preset) => preset.url === normalized);
}
