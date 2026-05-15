export const AVATAR_PRESETS = [
    { id: "duck-01", label: "Duck 01", url: "/avatar-presets/photos/duck-01.jpg", category: "duck" },
    { id: "duck-02", label: "Duck 02", url: "/avatar-presets/photos/duck-02.jpg", category: "duck" },
    { id: "duck-03", label: "Duck 03", url: "/avatar-presets/photos/duck-03.jpg", category: "duck" },
    { id: "duck-04", label: "Duck 04", url: "/avatar-presets/photos/duck-04.jpg", category: "duck" },
    { id: "duck-05", label: "Duck 05", url: "/avatar-presets/photos/duck-05.jpg", category: "duck" },
    { id: "duck-06", label: "Duck 06", url: "/avatar-presets/photos/duck-06.jpg", category: "duck" },
    { id: "swan-01", label: "Swan 01", url: "/avatar-presets/photos/swan-01.jpg", category: "swan" },
    { id: "swan-02", label: "Swan 02", url: "/avatar-presets/photos/swan-02.jpg", category: "swan" },
    { id: "swan-03", label: "Swan 03", url: "/avatar-presets/photos/swan-03.jpg", category: "swan" },
    { id: "swan-04", label: "Swan 04", url: "/avatar-presets/photos/swan-04.jpg", category: "swan" },
    { id: "swan-05", label: "Swan 05", url: "/avatar-presets/photos/swan-05.jpg", category: "swan" },
    { id: "swan-06", label: "Swan 06", url: "/avatar-presets/photos/swan-06.jpg", category: "swan" },
    { id: "swan-07", label: "Swan 07", url: "/avatar-presets/photos/swan-07.jpg", category: "swan" },
    { id: "swan-08", label: "Swan 08", url: "/avatar-presets/photos/swan-08.jpg", category: "swan" },
    { id: "fish-01", label: "Fish 01", url: "/avatar-presets/photos/fish-01.jpg", category: "fish" },
    { id: "fish-02", label: "Fish 02", url: "/avatar-presets/photos/fish-02.jpg", category: "fish" },
    { id: "fish-04", label: "Fish 04", url: "/avatar-presets/photos/fish-04.jpg", category: "fish" },
    { id: "fish-05", label: "Fish 05", url: "/avatar-presets/photos/fish-05.jpg", category: "fish" },
    { id: "fish-08", label: "Fish 08", url: "/avatar-presets/photos/fish-08.jpg", category: "fish" },
    { id: "fish-09", label: "Fish 09", url: "/avatar-presets/photos/fish-09.jpg", category: "fish" },
    { id: "fish-10", label: "Fish 10", url: "/avatar-presets/photos/fish-10.jpg", category: "fish" },
    { id: "dog-01", label: "Dog 01", url: "/avatar-presets/photos/dog-01.jpg", category: "dog" },
    { id: "dog-02", label: "Dog 02", url: "/avatar-presets/photos/dog-02.jpg", category: "dog" },
    { id: "dog-03", label: "Dog 03", url: "/avatar-presets/photos/dog-03.jpg", category: "dog" },
    { id: "dog-04", label: "Dog 04", url: "/avatar-presets/photos/dog-04.jpg", category: "dog" },
    { id: "dog-05", label: "Dog 05", url: "/avatar-presets/photos/dog-05.jpg", category: "dog" },
    { id: "dog-06", label: "Dog 06", url: "/avatar-presets/photos/dog-06.jpg", category: "dog" },
    { id: "dog-07", label: "Dog 07", url: "/avatar-presets/photos/dog-07.jpg", category: "dog" },
    { id: "dog-08", label: "Dog 08", url: "/avatar-presets/photos/dog-08.jpg", category: "dog" },
];

export function isAvatarPresetUrl(value) {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized) return false;
    return AVATAR_PRESETS.some((preset) => preset.url === normalized);
}
