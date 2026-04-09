import { getCurrentWindow, type Window } from '@tauri-apps/api/window';

export const DESIGN_THEME_IDS = [
  'obsidian-halo',
  'shadow-satin',
  'olympian-marble',
  'retro-signal',
  'fantasy-relic',
  'retro-arcade',
  'modern-glass',
  'universe-drift',
  'creed-eclipse',
  'volt-forge',
  'brass-engine',
  'shadow-monarch',
  'tsukuyomi-veil',
  'anime-companion',
  'kitsune-matsuri',
] as const;
export type DesignThemeId = (typeof DESIGN_THEME_IDS)[number];

export type DesignThemeOption = {
  id: DesignThemeId;
  label: string;
  description: string;
  accent: string;
  contrast: string;
  colorScheme: 'dark' | 'light';
};

export const DEFAULT_DESIGN_THEME_ID: DesignThemeId = 'obsidian-halo';

export const DESIGN_THEME_OPTIONS: DesignThemeOption[] = [
  {
    id: 'obsidian-halo',
    label: 'Obsidian Halo',
    description: 'Deep black panels, bright white highlights, and a strong outer glow around frames and the orb.',
    accent: 'Black glass / white glow',
    contrast: 'High contrast',
    colorScheme: 'dark',
  },
  {
    id: 'shadow-satin',
    label: 'Shadow Satin',
    description: 'Graphite surfaces with softer silver edges for a calmer, more matte desktop look.',
    accent: 'Graphite / satin silver',
    contrast: 'Balanced contrast',
    colorScheme: 'dark',
  },
  {
    id: 'olympian-marble',
    label: 'Olympian Marble',
    description: 'White marble surfaces with fine dark veins, brushed gold framing, and cooler silver support accents.',
    accent: 'Marble / gold leaf',
    contrast: 'Light luxury',
    colorScheme: 'light',
  },
  {
    id: 'retro-signal',
    label: 'Retro Signal',
    description: 'A warm CRT-inspired retro look with amber glow, teal edge light, and subtle scanline texture.',
    accent: 'Amber / phosphor teal',
    contrast: 'Retro neon',
    colorScheme: 'dark',
  },
  {
    id: 'fantasy-relic',
    label: 'Fantasy Relic',
    description: 'Velvet night panels, enchanted jewel tones, and a rune-crystal orb instead of the black-hole core.',
    accent: 'Amethyst / mint sigils',
    contrast: 'Mystic contrast',
    colorScheme: 'dark',
  },
  {
    id: 'retro-arcade',
    label: 'Retro Arcade',
    description: 'Magenta-cyan arcade surfaces with a scanline pulse orb and animated level bars.',
    accent: 'Neon magenta / cyan',
    contrast: 'Arcade glow',
    colorScheme: 'dark',
  },
  {
    id: 'modern-glass',
    label: 'Modern Glass',
    description: 'Clean frosted panels, cool blue highlights, and a minimal glass pulse orb with orbiting nodes.',
    accent: 'Ice glass / cobalt',
    contrast: 'Soft modern light',
    colorScheme: 'light',
  },
  {
    id: 'universe-drift',
    label: 'Universe Drift',
    description: 'Nebula gradients, deep midnight framing, and a planetary orbit orb with drifting satellites.',
    accent: 'Starlight / cosmic violet',
    contrast: 'Deep space glow',
    colorScheme: 'dark',
  },
  {
    id: 'creed-eclipse',
    label: 'Animus Eclipse',
    description: 'Animus-inspired holographic whites, icy cyan telemetry, and a synchronisation orb with scanning rings and data nodes.',
    accent: 'Sync white / animus cyan',
    contrast: 'Simulation glow',
    colorScheme: 'dark',
  },
  {
    id: 'volt-forge',
    label: 'Volt Forge',
    description: 'Black alloy chassis, toxic volt tracers, and a reactor orb carved from hex steel and neon surge blades.',
    accent: 'Volt green / gunmetal',
    contrast: 'Predatory neon',
    colorScheme: 'dark',
  },
  {
    id: 'brass-engine',
    label: 'Brass Engine',
    description: 'Riveted brass housings, furnace amber pressure lights, and a clockwork reactor orb wrapped in steam and gears.',
    accent: 'Brass / furnace amber',
    contrast: 'Industrial opulence',
    colorScheme: 'dark',
  },
  {
    id: 'shadow-monarch',
    label: 'Shadow Monarch',
    description: 'Ink-black obsidian, abyssal indigo glows, and a shadow-gate orb with summoned shards and spectral smoke.',
    accent: 'Void violet / royal blue',
    contrast: 'Abyssal anime glow',
    colorScheme: 'dark',
  },
  {
    id: 'tsukuyomi-veil',
    label: 'Tsukuyomi Veil',
    description: 'Moonlit indigo lacquer, silver shrine accents, and a lunar eclipse orb wrapped in drifting veils and glyph petals.',
    accent: 'Moon silver / midnight violet',
    contrast: 'Mythic moonlight',
    colorScheme: 'dark',
  },
  {
    id: 'anime-companion',
    label: 'Anime Companion',
    description: 'A vivid 2D companion theme with sakura-pink neon, cyan sparkle trails, and a small animated character replacing the orb.',
    accent: 'Sakura pink / aqua spark',
    contrast: 'Animated companion',
    colorScheme: 'dark',
  },
  {
    id: 'kitsune-matsuri',
    label: 'Kitsune Matsuri',
    description: 'A sharp Japanese festival theme with vermilion lacquer frames, washi-gold glow, shoji motion, and a fox-mask voice overlay.',
    accent: 'Vermilion / washi gold',
    contrast: 'Festival lacquer',
    colorScheme: 'dark',
  },
];

export function normalizeDesignThemeId(value: string | null | undefined): DesignThemeId {
  return DESIGN_THEME_IDS.find((themeId) => themeId === value) ?? DEFAULT_DESIGN_THEME_ID;
}

export function getDesignThemeLabel(value: string | null | undefined): string {
  const normalized = normalizeDesignThemeId(value);
  return DESIGN_THEME_OPTIONS.find((theme) => theme.id === normalized)?.label ?? 'Obsidian Halo';
}

export function getDesignThemeOption(value: string | null | undefined): DesignThemeOption {
  const normalized = normalizeDesignThemeId(value);
  return DESIGN_THEME_OPTIONS.find((theme) => theme.id === normalized) ?? DESIGN_THEME_OPTIONS[0];
}

export async function applyDesignTheme(
  value: string | null | undefined,
  targetWindow?: Window,
): Promise<DesignThemeId> {
  const theme = getDesignThemeOption(value);
  document.documentElement.dataset.theme = theme.id;
  document.body.dataset.theme = theme.id;
  document.documentElement.style.colorScheme = theme.colorScheme;
  document.body.style.colorScheme = theme.colorScheme;

  try {
    await (targetWindow ?? getCurrentWindow()).setTheme(theme.colorScheme);
  } catch {
    // Window theming is best-effort for native chrome only.
  }

  return theme.id;
}
