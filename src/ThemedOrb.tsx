import type { CSSProperties } from 'react';
import type { DesignThemeId } from './designThemes';
import BlackHoleOrb from './BlackHoleOrb';
import './themedOrb.css';

type ThemedOrbProps = {
  themeId: DesignThemeId;
  isVisible: boolean;
  isListening: boolean;
  isThinking: boolean;
  isSpeaking: boolean;
  title: string;
  onClick: () => void;
};

type OrbVariant =
  | 'black-hole'
  | 'shadow'
  | 'marble'
  | 'signal'
  | 'fantasy'
  | 'retro'
  | 'modern'
  | 'universe'
  | 'assassin'
  | 'razor'
  | 'steam'
  | 'monarch'
  | 'tsukuyomi'
  | 'anime'
  | 'kitsune';

const FANTASY_GLYPH_POSITIONS = [
  { angle: 0, distance: 76 },
  { angle: 45, distance: 70 },
  { angle: 90, distance: 76 },
  { angle: 135, distance: 70 },
  { angle: 180, distance: 76 },
  { angle: 225, distance: 70 },
  { angle: 270, distance: 76 },
  { angle: 315, distance: 70 },
];

const FANTASY_SPARK_POSITIONS = [
  { top: '18%', left: '26%', delay: '0.2s' },
  { top: '28%', left: '76%', delay: '1.1s' },
  { top: '74%', left: '22%', delay: '0.8s' },
  { top: '70%', left: '78%', delay: '1.5s' },
];

const UNIVERSE_STAR_POSITIONS = [
  { top: '18%', left: '36%', delay: '0.2s' },
  { top: '24%', left: '72%', delay: '1.4s' },
  { top: '44%', left: '18%', delay: '0.9s' },
  { top: '68%', left: '28%', delay: '1.8s' },
  { top: '74%', left: '74%', delay: '0.5s' },
];

const SIGNAL_BLIP_POSITIONS = [
  { top: '30%', left: '62%', delay: '0.2s' },
  { top: '44%', left: '74%', delay: '1.1s' },
  { top: '58%', left: '36%', delay: '0.7s' },
  { top: '70%', left: '60%', delay: '1.5s' },
];

const OLYMPIAN_RAY_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

const ANIMUS_NODE_POSITIONS = [
  { top: '22%', left: '50%', delay: '0.1s' },
  { top: '40%', left: '76%', delay: '0.8s' },
  { top: '74%', left: '58%', delay: '1.4s' },
  { top: '66%', left: '24%', delay: '1.1s' },
];

const STEAM_PLUME_POSITIONS = [
  { top: '20%', left: '28%', delay: '0.2s', scale: 0.88 },
  { top: '12%', left: '50%', delay: '1.1s', scale: 1 },
  { top: '22%', left: '68%', delay: '0.7s', scale: 0.82 },
];

const MONARCH_SHARD_POSITIONS = [
  { angle: -18, distance: 72, delay: '0.3s' },
  { angle: 104, distance: 70, delay: '1.1s' },
  { angle: 214, distance: 74, delay: '0.8s' },
];

const TSUKUYOMI_SIGIL_ANGLES = [0, 60, 120, 180, 240, 300];

const ANIME_SPARKLE_POSITIONS = [
  { top: '12%', left: '26%', delay: '0.1s', scale: 0.84 },
  { top: '18%', left: '78%', delay: '1.2s', scale: 1 },
  { top: '58%', left: '14%', delay: '0.7s', scale: 0.72 },
  { top: '76%', left: '82%', delay: '1.8s', scale: 0.9 },
];

const ANIME_WAVE_DELAYS = ['0s', '0.24s', '0.48s'];

const KITSUNE_PETAL_POSITIONS = [
  { top: '10%', left: '24%', delay: '0.2s', rotate: -18 },
  { top: '20%', left: '78%', delay: '1.1s', rotate: 22 },
  { top: '64%', left: '18%', delay: '1.7s', rotate: 36 },
  { top: '74%', left: '72%', delay: '0.8s', rotate: -34 },
];

function joinClassNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

function resolveOrbVariant(themeId: DesignThemeId): OrbVariant {
  switch (themeId) {
    case 'shadow-satin':
      return 'shadow';
    case 'olympian-marble':
      return 'marble';
    case 'retro-signal':
      return 'signal';
    case 'fantasy-relic':
      return 'fantasy';
    case 'retro-arcade':
      return 'retro';
    case 'modern-glass':
      return 'modern';
    case 'universe-drift':
      return 'universe';
    case 'creed-eclipse':
      return 'assassin';
    case 'volt-forge':
      return 'razor';
    case 'brass-engine':
      return 'steam';
    case 'shadow-monarch':
      return 'monarch';
    case 'tsukuyomi-veil':
      return 'tsukuyomi';
    case 'anime-companion':
      return 'anime';
    case 'kitsune-matsuri':
      return 'kitsune';
    default:
      return 'black-hole';
  }
}

function stateClassName(isListening: boolean, isThinking: boolean, isSpeaking: boolean): string {
  if (isSpeaking) {
    return 'themed-orb--speaking';
  }
  if (isThinking) {
    return 'themed-orb--thinking';
  }
  if (isListening) {
    return 'themed-orb--listening';
  }
  return 'themed-orb--idle';
}

function renderFantasyOrb() {
  return (
    <>
      <span className="themed-orb__backdrop" />
      <span className="fantasy-orb__mist fantasy-orb__mist--outer" />
      <span className="fantasy-orb__mist fantasy-orb__mist--inner" />
      <span className="fantasy-orb__sigil fantasy-orb__sigil--outer" />
      <span className="fantasy-orb__sigil fantasy-orb__sigil--middle" />
      <span className="fantasy-orb__sigil fantasy-orb__sigil--inner" />

      {FANTASY_GLYPH_POSITIONS.map((glyph, index) => (
        <span
          key={`fantasy-glyph-${glyph.angle}-${glyph.distance}`}
          className="fantasy-orb__glyph"
          style={
            {
              transform: `translate(-50%, -50%) rotate(${glyph.angle}deg) translateY(-${glyph.distance}px)`,
              animationDelay: `${index * 0.14}s`,
            } as CSSProperties
          }
        />
      ))}

      {FANTASY_SPARK_POSITIONS.map((spark, index) => (
        <span
          key={`fantasy-spark-${spark.top}-${spark.left}`}
          className="fantasy-orb__spark"
          style={
            {
              top: spark.top,
              left: spark.left,
              animationDelay: spark.delay,
              opacity: index % 2 === 0 ? 0.85 : 0.56,
            } as CSSProperties
          }
        />
      ))}

      <span className="fantasy-orb__crystal">
        <span className="fantasy-orb__crystal-core" />
      </span>
    </>
  );
}

function renderShadowOrb() {
  return (
    <>
      <span className="themed-orb__backdrop" />
      <span className="shadow-orb__shell" />
      <span className="shadow-orb__ring shadow-orb__ring--outer" />
      <span className="shadow-orb__ring shadow-orb__ring--middle" />
      <span className="shadow-orb__ring shadow-orb__ring--inner" />
      <span className="shadow-orb__sheen shadow-orb__sheen--a" />
      <span className="shadow-orb__sheen shadow-orb__sheen--b" />
      <span className="shadow-orb__orbit shadow-orb__orbit--outer">
        <span className="shadow-orb__node shadow-orb__node--outer" />
      </span>
      <span className="shadow-orb__orbit shadow-orb__orbit--inner">
        <span className="shadow-orb__node shadow-orb__node--inner" />
      </span>
      <span className="shadow-orb__core">
        <span className="shadow-orb__core-accent" />
      </span>
    </>
  );
}

function renderMarbleOrb() {
  return (
    <>
      <span className="themed-orb__backdrop" />
      <span className="marble-orb__sanctum" />
      <span className="marble-orb__ring marble-orb__ring--outer" />
      <span className="marble-orb__ring marble-orb__ring--middle" />
      <span className="marble-orb__ring marble-orb__ring--inner" />
      {OLYMPIAN_RAY_ANGLES.map((angle, index) => (
        <span
          key={`olympian-ray-${angle}`}
          className="marble-orb__ray"
          style={
            {
              transform: `translate(-50%, -50%) rotate(${angle}deg) translateY(-82px)`,
              animationDelay: `${index * 0.08}s`,
            } as CSSProperties
          }
        />
      ))}
      <span className="marble-orb__disc">
        <span className="marble-orb__disc-glow" />
        <span className="marble-orb__core" />
      </span>
    </>
  );
}

function renderSignalOrb() {
  return (
    <>
      <span className="themed-orb__backdrop" />
      <span className="signal-orb__radar">
        <span className="signal-orb__grid signal-orb__grid--outer" />
        <span className="signal-orb__grid signal-orb__grid--inner" />
        <span className="signal-orb__sweep" />
        <span className="signal-orb__pulse signal-orb__pulse--outer" />
        <span className="signal-orb__pulse signal-orb__pulse--inner" />
        <span className="signal-orb__core" />

        {SIGNAL_BLIP_POSITIONS.map((blip, index) => (
          <span
            key={`signal-blip-${blip.top}-${blip.left}`}
            className="signal-orb__blip"
            style={
              {
                top: blip.top,
                left: blip.left,
                animationDelay: blip.delay,
                opacity: index % 2 === 0 ? 0.9 : 0.58,
              } as CSSProperties
            }
          />
        ))}
      </span>
    </>
  );
}

function renderRetroOrb() {
  return (
    <>
      <span className="themed-orb__backdrop" />
      <span className="retro-orb__screen">
        <span className="retro-orb__glow" />
        <span className="retro-orb__grid" />
        <span className="retro-orb__scanline" />
        <span className="retro-orb__ring retro-orb__ring--outer" />
        <span className="retro-orb__ring retro-orb__ring--inner" />
        <span className="retro-orb__core" />
        <span className="retro-orb__bars">
          {Array.from({ length: 5 }, (_, index) => (
            <span
              key={`retro-bar-${index + 1}`}
              className="retro-orb__bar"
              style={{ animationDelay: `${index * 0.12}s` }}
            />
          ))}
        </span>
      </span>
    </>
  );
}

function renderModernOrb() {
  return (
    <>
      <span className="themed-orb__backdrop" />
      <span className="modern-orb__shell">
        <span className="modern-orb__halo" />
        <span className="modern-orb__ring modern-orb__ring--outer" />
        <span className="modern-orb__ring modern-orb__ring--middle" />
        <span className="modern-orb__ring modern-orb__ring--inner" />
        <span className="modern-orb__satellite modern-orb__satellite--outer">
          <span className="modern-orb__node modern-orb__node--outer" />
        </span>
        <span className="modern-orb__satellite modern-orb__satellite--inner">
          <span className="modern-orb__node modern-orb__node--inner" />
        </span>
        <span className="modern-orb__core modern-orb__core--main" />
        <span className="modern-orb__core modern-orb__core--accent" />
      </span>
    </>
  );
}

function renderUniverseOrb() {
  return (
    <>
      <span className="themed-orb__backdrop" />
      <span className="universe-orb__nebula universe-orb__nebula--a" />
      <span className="universe-orb__nebula universe-orb__nebula--b" />
      <span className="universe-orb__nebula universe-orb__nebula--c" />
      <span className="universe-orb__orbit universe-orb__orbit--outer">
        <span className="universe-orb__moon universe-orb__moon--outer" />
      </span>
      <span className="universe-orb__orbit universe-orb__orbit--inner">
        <span className="universe-orb__moon universe-orb__moon--inner" />
      </span>
      <span className="universe-orb__planet">
        <span className="universe-orb__planet-core" />
      </span>
      <span className="universe-orb__comet" />

      {UNIVERSE_STAR_POSITIONS.map((star, index) => (
        <span
          key={`universe-star-${star.top}-${star.left}`}
          className="universe-orb__star"
          style={
            {
              top: star.top,
              left: star.left,
              animationDelay: star.delay,
              opacity: index % 2 === 0 ? 0.9 : 0.58,
            } as CSSProperties
          }
        />
      ))}
    </>
  );
}

function renderAssassinOrb() {
  return (
    <>
      <span className="themed-orb__backdrop" />
      <span className="assassin-orb__field" />
      <span className="assassin-orb__ring assassin-orb__ring--outer" />
      <span className="assassin-orb__ring assassin-orb__ring--middle" />
      <span className="assassin-orb__ring assassin-orb__ring--inner" />
      <span className="assassin-orb__beam assassin-orb__beam--vertical" />
      <span className="assassin-orb__beam assassin-orb__beam--horizontal" />
      <span className="assassin-orb__core">
        <span className="assassin-orb__core-mark" />
      </span>

      {ANIMUS_NODE_POSITIONS.map((node, index) => (
        <span
          key={`animus-node-${node.top}-${node.left}`}
          className="assassin-orb__node"
          style={
            {
              top: node.top,
              left: node.left,
              animationDelay: node.delay,
              opacity: index % 2 === 0 ? 0.92 : 0.58,
            } as CSSProperties
          }
        />
      ))}
    </>
  );
}

function renderRazorOrb() {
  return (
    <>
      <span className="themed-orb__backdrop" />
      <span className="razor-orb__hex" />
      <span className="razor-orb__ring razor-orb__ring--outer" />
      <span className="razor-orb__ring razor-orb__ring--middle" />
      <span className="razor-orb__ring razor-orb__ring--inner" />
      <span className="razor-orb__blade razor-orb__blade--a" />
      <span className="razor-orb__blade razor-orb__blade--b" />
      <span className="razor-orb__blade razor-orb__blade--c" />
      <span className="razor-orb__coil" />
      <span className="razor-orb__core">
        <span className="razor-orb__core-pulse" />
      </span>
      <span className="razor-orb__spark razor-orb__spark--left" />
      <span className="razor-orb__spark razor-orb__spark--right" />
    </>
  );
}

function renderSteamOrb() {
  return (
    <>
      <span className="themed-orb__backdrop" />
      <span className="steam-orb__gear steam-orb__gear--outer" />
      <span className="steam-orb__gear steam-orb__gear--inner" />
      <span className="steam-orb__pipe steam-orb__pipe--left" />
      <span className="steam-orb__pipe steam-orb__pipe--right" />
      <span className="steam-orb__gauge" />
      <span className="steam-orb__core">
        <span className="steam-orb__furnace" />
      </span>

      {STEAM_PLUME_POSITIONS.map((plume) => (
        <span
          key={`steam-plume-${plume.top}-${plume.left}`}
          className="steam-orb__steam"
          style={
            {
              top: plume.top,
              left: plume.left,
              animationDelay: plume.delay,
              '--steam-scale': plume.scale.toString(),
            } as CSSProperties
          }
        />
      ))}
    </>
  );
}

function renderMonarchOrb() {
  return (
    <>
      <span className="themed-orb__backdrop" />
      <span className="monarch-orb__gate" />
      <span className="monarch-orb__ring monarch-orb__ring--outer" />
      <span className="monarch-orb__ring monarch-orb__ring--inner" />
      <span className="monarch-orb__mist monarch-orb__mist--a" />
      <span className="monarch-orb__mist monarch-orb__mist--b" />
      <span className="monarch-orb__core">
        <span className="monarch-orb__iris" />
      </span>

      {MONARCH_SHARD_POSITIONS.map((shard) => (
        <span
          key={`monarch-shard-${shard.angle}-${shard.distance}`}
          className="monarch-orb__shard"
          style={
            {
              transform: `translate(-50%, -50%) rotate(${shard.angle}deg) translateY(-${shard.distance}px)`,
              animationDelay: shard.delay,
            } as CSSProperties
          }
        />
      ))}
    </>
  );
}

function renderTsukuyomiOrb() {
  return (
    <>
      <span className="themed-orb__backdrop" />
      <span className="tsukuyomi-orb__moon" />
      <span className="tsukuyomi-orb__crescent" />
      <span className="tsukuyomi-orb__ring tsukuyomi-orb__ring--outer" />
      <span className="tsukuyomi-orb__ring tsukuyomi-orb__ring--inner" />
      <span className="tsukuyomi-orb__veil tsukuyomi-orb__veil--a" />
      <span className="tsukuyomi-orb__veil tsukuyomi-orb__veil--b" />
      {TSUKUYOMI_SIGIL_ANGLES.map((angle, index) => (
        <span
          key={`tsukuyomi-sigil-${angle}`}
          className="tsukuyomi-orb__sigil"
          style={
            {
              transform: `translate(-50%, -50%) rotate(${angle}deg) translateY(-74px)`,
              animationDelay: `${index * 0.12}s`,
            } as CSSProperties
          }
        />
      ))}
      <span className="tsukuyomi-orb__core" />
    </>
  );
}

function renderAnimeCompanion() {
  return (
    <>
      <span className="anime-companion__aura" />
      <span className="anime-companion__halo" />
      <span className="anime-companion__wavefield">
        {ANIME_WAVE_DELAYS.map((delay, index) => (
          <span
            key={`anime-wave-${delay}`}
            className="anime-companion__wave"
            style={
              {
                animationDelay: delay,
                '--anime-wave-inset': `${index * 8}px`,
              } as CSSProperties
            }
          />
        ))}
      </span>

      {ANIME_SPARKLE_POSITIONS.map((spark) => (
        <span
          key={`anime-spark-${spark.top}-${spark.left}`}
          className="anime-companion__sparkle"
          style={
            {
              top: spark.top,
              left: spark.left,
              animationDelay: spark.delay,
              '--anime-spark-scale': spark.scale.toString(),
            } as CSSProperties
          }
        />
      ))}

      <span className="anime-companion__ground-shadow" />
      <span className="anime-companion__hair anime-companion__hair--back" />
      <span className="anime-companion__side-lock anime-companion__side-lock--left" />
      <span className="anime-companion__side-lock anime-companion__side-lock--right" />
      <span className="anime-companion__arm anime-companion__arm--left">
        <span className="anime-companion__hand anime-companion__hand--left" />
      </span>
      <span className="anime-companion__arm anime-companion__arm--right">
        <span className="anime-companion__hand anime-companion__hand--right" />
      </span>
      <span className="anime-companion__body">
        <span className="anime-companion__collar anime-companion__collar--left" />
        <span className="anime-companion__collar anime-companion__collar--right" />
        <span className="anime-companion__tie" />
      </span>
      <span className="anime-companion__skirt">
        <span className="anime-companion__skirt-line anime-companion__skirt-line--left" />
        <span className="anime-companion__skirt-line anime-companion__skirt-line--right" />
      </span>
      <span className="anime-companion__leg anime-companion__leg--left" />
      <span className="anime-companion__leg anime-companion__leg--right" />
      <span className="anime-companion__shoe anime-companion__shoe--left" />
      <span className="anime-companion__shoe anime-companion__shoe--right" />
      <span className="anime-companion__neck" />
      <span className="anime-companion__head">
        <span className="anime-companion__bang anime-companion__bang--left" />
        <span className="anime-companion__bang anime-companion__bang--middle" />
        <span className="anime-companion__bang anime-companion__bang--right" />
        <span className="anime-companion__eye anime-companion__eye--left" />
        <span className="anime-companion__eye anime-companion__eye--right" />
        <span className="anime-companion__blush anime-companion__blush--left" />
        <span className="anime-companion__blush anime-companion__blush--right" />
        <span className="anime-companion__mouth" />
      </span>
      <span className="anime-companion__ribbon anime-companion__ribbon--left" />
      <span className="anime-companion__ribbon anime-companion__ribbon--right" />
    </>
  );
}

function renderKitsuneOrb() {
  return (
    <>
      <span className="themed-orb__backdrop" />
      <span className="kitsune-orb__gate kitsune-orb__gate--top" />
      <span className="kitsune-orb__gate kitsune-orb__gate--cross" />
      <span className="kitsune-orb__post kitsune-orb__post--left" />
      <span className="kitsune-orb__post kitsune-orb__post--right" />
      <span className="kitsune-orb__cord" />
      <span className="kitsune-orb__lantern" />
      <span className="kitsune-orb__mask">
        <span className="kitsune-orb__ear kitsune-orb__ear--left" />
        <span className="kitsune-orb__ear kitsune-orb__ear--right" />
        <span className="kitsune-orb__eye kitsune-orb__eye--left" />
        <span className="kitsune-orb__eye kitsune-orb__eye--right" />
        <span className="kitsune-orb__mark kitsune-orb__mark--center" />
        <span className="kitsune-orb__mark kitsune-orb__mark--left" />
        <span className="kitsune-orb__mark kitsune-orb__mark--right" />
      </span>

      {KITSUNE_PETAL_POSITIONS.map((petal) => (
        <span
          key={`kitsune-petal-${petal.top}-${petal.left}`}
          className="kitsune-orb__petal"
          style={
            {
              top: petal.top,
              left: petal.left,
              animationDelay: petal.delay,
              '--kitsune-petal-rotate': `${petal.rotate}deg`,
            } as CSSProperties
          }
        />
      ))}
    </>
  );
}

export default function ThemedOrb({
  themeId,
  isVisible,
  isListening,
  isThinking,
  isSpeaking,
  title,
  onClick,
}: ThemedOrbProps) {
  const variant = resolveOrbVariant(themeId);

  if (variant === 'black-hole') {
    return (
      <BlackHoleOrb
        isVisible={isVisible}
        isListening={isListening}
        isThinking={isThinking}
        isSpeaking={isSpeaking}
        title={title}
        onClick={onClick}
      />
    );
  }

  return (
    <button
      type="button"
      className={joinClassNames(
        'themed-orb',
        `themed-orb--${variant}`,
        stateClassName(isListening, isThinking, isSpeaking),
        !isVisible && 'themed-orb--hidden',
      )}
      onClick={onClick}
      title={title}
      aria-label="AI voice overlay"
    >
      <div className="themed-orb__stage">
        {variant === 'shadow' ? renderShadowOrb() : null}
        {variant === 'marble' ? renderMarbleOrb() : null}
        {variant === 'signal' ? renderSignalOrb() : null}
        {variant === 'fantasy' ? renderFantasyOrb() : null}
        {variant === 'retro' ? renderRetroOrb() : null}
        {variant === 'modern' ? renderModernOrb() : null}
        {variant === 'universe' ? renderUniverseOrb() : null}
        {variant === 'assassin' ? renderAssassinOrb() : null}
        {variant === 'razor' ? renderRazorOrb() : null}
        {variant === 'steam' ? renderSteamOrb() : null}
        {variant === 'monarch' ? renderMonarchOrb() : null}
        {variant === 'tsukuyomi' ? renderTsukuyomiOrb() : null}
        {variant === 'anime' ? renderAnimeCompanion() : null}
        {variant === 'kitsune' ? renderKitsuneOrb() : null}
      </div>
    </button>
  );
}
