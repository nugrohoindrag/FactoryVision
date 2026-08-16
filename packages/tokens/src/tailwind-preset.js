/**
 * Shared Tailwind preset — the only place raw scale values live.
 * Consumed by apps/wms and (later) apps/landing so both render the same system.
 *
 * Every color resolves through a CSS variable from globals.css. Nothing here
 * is a literal hex: changing a token changes every app (DS §16.3).
 */

/**
 * Every colour resolves through a CSS variable holding OKLCH channels.
 * OKLCH is what lets the palette be this saturated and still behave: its
 * lightness is perceptual, so a 600 step carries the same visual weight in
 * every hue instead of amber reading twice as bright as indigo.
 *
 * @param {string} v
 */
const c = (v) => `oklch(var(${v}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  theme: {
    // DS §12.1 — mobile-up. `xs` is the unprefixed base (<480px, phone).
    screens: {
      sm: '480px',
      md: '768px',
      lg: '1024px',
      xl: '1440px',
    },
    extend: {
      colors: {
        // shadcn surface
        background: c('--background'),
        foreground: c('--foreground'),
        card: { DEFAULT: c('--card'), foreground: c('--card-foreground') },
        popover: { DEFAULT: c('--popover'), foreground: c('--popover-foreground') },
        primary: { DEFAULT: c('--primary'), foreground: c('--primary-foreground'), hover: c('--color-primary-hover') },
        secondary: { DEFAULT: c('--secondary'), foreground: c('--secondary-foreground') },
        muted: { DEFAULT: c('--muted'), foreground: c('--muted-foreground') },
        accent: { DEFAULT: c('--accent'), foreground: c('--accent-foreground') },
        destructive: { DEFAULT: c('--destructive'), foreground: c('--destructive-foreground') },
        border: c('--border'),
        input: c('--input'),
        ring: c('--ring'),

        /**
         * INK — the neutral ramp. There is no grey in this product.
         *
         * Every step carries the brand's indigo at low chroma, so "neutral"
         * chrome belongs to the same family as the brand instead of sitting
         * next to it.
         *
         * `gray` used to be kept here as an alias, overriding Tailwind's stock
         * grey so that the `text-gray-600` calls already scattered through the
         * components stopped resolving to a second, foreign neutral family.
         * Every one of those call sites now names a semantic token instead, so
         * the alias is gone — and with it the possibility of writing
         * `bg-gray-500` and getting something that silently works.
         */
        ink: {
          50: c('--ink-100'),
          100: c('--ink-100'),
          200: c('--ink-200'),
          300: c('--ink-300'),
          400: c('--ink-400'),
          500: c('--ink-500'),
          600: c('--ink-600'),
          700: c('--ink-700'),
          800: c('--ink-800'),
          900: c('--ink-900'),
          950: c('--ink-950'),
        },

        /** The brand ramp, for tints and hairlines that are not `--primary`. */
        brand: {
          50: c('--primary-50'),
          100: c('--primary-100'),
          200: c('--primary-200'),
          300: c('--primary-300'),
          400: c('--primary-400'),
          500: c('--primary-500'),
          600: c('--primary-600'),
          700: c('--primary-700'),
          800: c('--primary-800'),
          900: c('--primary-900'),
          950: c('--primary-950'),
        },

        // FactoryVision semantic aliases
        surface: {
          page: c('--surface-page'),
          card: c('--surface-card'),
          raised: c('--surface-raised'),
          sunken: c('--surface-sunken'),
          secondary: c('--surface-secondary'),
        },
        text: {
          primary: c('--text-primary'),
          secondary: c('--text-secondary'),
          disabled: c('--text-disabled'),
        },

        /**
         * Status scale (DS §2.3).
         *   st-x        the solid fill used by badges and filled cards
         *   st-x-on     the ONLY foreground allowed on that fill
         *   st-x-bg/fg  the light pairing, for large surfaces only
         *
         * `-on` exists because the fills are vivid now. White is correct on
         * red, blue and violet and illegible on yellow and green — hard-coding
         * `text-white` next to `bg-st-warning` is exactly the 2.15:1 badge the
         * palette shipped with before anyone measured it.
         */
        st: {
          success: c('--st-success'),
          'success-on': c('--st-success-on'),
          'success-bg': c('--st-success-bg'),
          'success-fg': c('--st-success-fg'),
          warning: c('--st-warning'),
          'warning-on': c('--st-warning-on'),
          'warning-bg': c('--st-warning-bg'),
          'warning-fg': c('--st-warning-fg'),
          danger: c('--st-danger'),
          'danger-on': c('--st-danger-on'),
          'danger-bg': c('--st-danger-bg'),
          'danger-fg': c('--st-danger-fg'),
          info: c('--st-info'),
          'info-on': c('--st-info-on'),
          'info-bg': c('--st-info-bg'),
          'info-fg': c('--st-info-fg'),
          maintenance: c('--st-maintenance'),
          'maintenance-on': c('--st-maintenance-on'),
          'maintenance-bg': c('--st-maintenance-bg'),
          'maintenance-fg': c('--st-maintenance-fg'),
          neutral: c('--st-neutral'),
          'neutral-on': c('--st-neutral-on'),
          'neutral-bg': c('--st-neutral-bg'),
          'neutral-fg': c('--st-neutral-fg'),
          waiting: c('--st-waiting'),
          'waiting-on': c('--st-waiting-on'),
          'waiting-bg': c('--st-waiting-bg'),
          'waiting-fg': c('--st-waiting-fg'),
          released: c('--st-released'),
          'released-on': c('--st-released-on'),
          'released-bg': c('--st-released-bg'),
          'released-fg': c('--st-released-fg'),
        },
        /**
         * The only chroma-zero colours in the system — a thermal-label preview
         * must show what the printer produces, not what the screen prefers.
         */
        print: {
          ink: c('--print-ink'),
          rule: c('--print-rule'),
          muted: c('--print-muted'),
        },
        sync: {
          synced: c('--sync-synced'),
          pending: c('--sync-pending'),
          conflict: c('--sync-conflict'),
        },

        /**
         * shadcn parity — same names it ships, our hues underneath. Its stock
         * values are a zero-chroma grey ramp; every one of these is a colour.
         */
        chart: {
          1: c('--chart-1'),
          2: c('--chart-2'),
          3: c('--chart-3'),
          4: c('--chart-4'),
          5: c('--chart-5'),
        },
        sidebar: {
          DEFAULT: c('--sidebar'),
          foreground: c('--sidebar-foreground'),
          primary: c('--sidebar-primary'),
          'primary-foreground': c('--sidebar-primary-foreground'),
          accent: c('--sidebar-accent'),
          'accent-foreground': c('--sidebar-accent-foreground'),
          border: c('--sidebar-border'),
          ring: c('--sidebar-ring'),
        },

        /**
         * Data accents (v5.0) — for quantity and category, never for status.
         * A dashboard with one hue is a dashboard nobody can read at a glance,
         * and before these existed the only way to colour a second series was
         * to borrow `st-warning`, which then meant nothing.
         */
        data: {
          teal: c('--accent-teal'),
          'teal-on': c('--accent-teal-on'),
          'teal-soft': c('--accent-teal-soft'),
          'teal-fg': c('--accent-teal-fg'),
          cyan: c('--accent-cyan'),
          'cyan-on': c('--accent-cyan-on'),
          'cyan-soft': c('--accent-cyan-soft'),
          'cyan-fg': c('--accent-cyan-fg'),
          violet: c('--accent-violet'),
          'violet-on': c('--accent-violet-on'),
          'violet-soft': c('--accent-violet-soft'),
          'violet-fg': c('--accent-violet-fg'),
          rose: c('--accent-rose'),
          'rose-on': c('--accent-rose-on'),
          'rose-soft': c('--accent-rose-soft'),
          'rose-fg': c('--accent-rose-fg'),
          amber: c('--accent-amber'),
          'amber-on': c('--accent-amber-on'),
          'amber-soft': c('--accent-amber-soft'),
          'amber-fg': c('--accent-amber-fg'),
          lime: c('--accent-lime'),
          'lime-on': c('--accent-lime-on'),
          'lime-soft': c('--accent-lime-soft'),
          'lime-fg': c('--accent-lime-fg'),
          emerald: c('--accent-emerald'),
          'emerald-on': c('--accent-emerald-on'),
          'emerald-soft': c('--accent-emerald-soft'),
          'emerald-fg': c('--accent-emerald-fg'),
          fuchsia: c('--accent-fuchsia'),
          'fuchsia-on': c('--accent-fuchsia-on'),
          'fuchsia-soft': c('--accent-fuchsia-soft'),
          'fuchsia-fg': c('--accent-fuchsia-fg'),
          blue: c('--accent-blue'),
          'blue-on': c('--accent-blue-on'),
          'blue-soft': c('--accent-blue-soft'),
          'blue-fg': c('--accent-blue-fg'),
        },
      },

      /**
       * Named gradients (v5.0). Decoration only — status is still a solid
       * fill plus a label. Exposed as `bg-gradient-brand` etc., which also
       * keeps the design audit's ban on hand-rolled `from-*`/`via-*` intact.
       */
      backgroundImage: {
        'gradient-brand': 'var(--gradient-brand)',
        'gradient-danger': 'var(--gradient-danger)',
        'gradient-success': 'var(--gradient-success)',
        'gradient-warning': 'var(--gradient-warning)',
        'gradient-info': 'var(--gradient-info)',
        'gradient-surface': 'var(--gradient-surface)',
        'gradient-sheen': 'var(--gradient-sheen)',
      },

      /**
       * DS §2.4 — role-named, so JSX never carries a raw px size.
       *
       * Headings are FLUID, and the DS value is the maximum: at `xl` they are
       * exactly the specified 48/36/30/24/20px. Below that they scale down.
       *
       * The published scale is a desktop scale. Rendered unchanged on a 360px
       * phone a 36px heading eats a fifth of the viewport and shouts, which is
       * the opposite of the calm the design language asks for — and DS §12.1
       * says to design mobile-up. Body sizes stay fixed: they are already at
       * the 14px production minimum and must not shrink.
       */
      fontSize: {
        display: ['clamp(2rem, 5.5vw, 48px)', { lineHeight: '120%', letterSpacing: '-0.02em' }],
        h1: ['clamp(1.75rem, 4.8vw, 36px)', { lineHeight: '130%', letterSpacing: '-0.018em' }],
        h2: ['clamp(1.5rem, 4.2vw, 30px)', { lineHeight: '130%', letterSpacing: '-0.015em' }],
        h3: ['clamp(1.25rem, 3.4vw, 24px)', { lineHeight: '130%', letterSpacing: '-0.011em' }],
        title: ['clamp(1.0625rem, 2.6vw, 20px)', { lineHeight: '130%', letterSpacing: '-0.006em' }],
        'body-lg': ['18px', { lineHeight: '150%' }],
        body: ['16px', { lineHeight: '150%' }],
        'body-sm': ['14px', { lineHeight: '150%' }],
        caption: ['12px', { lineHeight: '150%' }],
      },

      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },

      borderRadius: {
        sm: 'var(--radius-sm)',
        btn: 'var(--radius-btn)',
        input: 'var(--radius-input)',
        card: 'var(--radius-card)',
        modal: 'var(--radius-modal)',
        pill: 'var(--radius-pill)',
        // shadcn's own scale, driven by --radius
        DEFAULT: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        lg: 'var(--radius)',
      },

      boxShadow: {
        1: 'var(--shadow-1)',
        2: 'var(--shadow-2)',
        3: 'var(--shadow-3)',
        hover: 'var(--shadow-hover)',
        // The single sanctioned coloured shadow — brand surfaces, decorative.
        brand: 'var(--shadow-brand)',
        focus: 'var(--shadow-focus)',
      },

      // Density-driven sizing (DS §3) — read from [data-density]
      height: {
        control: 'var(--size-control)',
        'control-sm': 'var(--size-control-sm)',
        'control-lg': 'var(--size-control-lg)',
        input: 'var(--size-input)',
        row: 'var(--size-row)',
        touch: 'var(--size-touch-min)',
        topnav: '72px',
        bottomnav: '64px',
      },
      minHeight: {
        touch: 'var(--size-touch-min)',
        control: 'var(--size-control)',
      },
      minWidth: {
        touch: 'var(--size-touch-min)',
        btn: '88px',
      },
      width: {
        sidebar: 'var(--size-sidebar)',
        'sidebar-collapsed': 'var(--size-sidebar-collapsed)',
      },
      padding: {
        card: 'var(--size-card-padding)',
      },

      transitionDuration: {
        DEFAULT: 'var(--motion-duration)',
        fast: 'var(--motion-fast)',
        slow: 'var(--motion-slow)',
        slower: 'var(--motion-slower)',
      },
      transitionTimingFunction: {
        DEFAULT: 'var(--motion-easing)',
        spring: 'var(--motion-spring)',
      },

      /**
       * Motion (DS §2.10, v5.0).
       *
       * Every animation here is *arrival* or *feedback* — a card landing, a
       * bar filling, a value that just changed. None of them is the only way
       * a state is communicated, so `prefers-reduced-motion` (handled in
       * globals.css) can flatten all of them without losing information.
       */
      keyframes: {
        rise: {
          from: { opacity: '0', transform: 'translate3d(0, 12px, 0)' },
          to: { opacity: '1', transform: 'none' },
        },
        fade: { from: { opacity: '0' }, to: { opacity: '1' } },
        pop: {
          from: { opacity: '0', transform: 'scale(0.94)' },
          to: { opacity: '1', transform: 'none' },
        },
        sheen: {
          from: { transform: 'translateX(-120%)' },
          to: { transform: 'translateX(220%)' },
        },
        'grow-x': { from: { transform: 'scaleX(0)' }, to: { transform: 'scaleX(1)' } },
        'grow-y': { from: { transform: 'scaleY(0)' }, to: { transform: 'scaleY(1)' } },
        'ping-soft': {
          '0%': { transform: 'scale(1)', opacity: '0.55' },
          '70%, 100%': { transform: 'scale(2.2)', opacity: '0' },
        },
        drift: {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
      },
      animation: {
        rise: 'rise var(--motion-slower) var(--motion-easing) backwards',
        fade: 'fade var(--motion-slow) var(--motion-easing) backwards',
        pop: 'pop var(--motion-slow) var(--motion-spring) backwards',
        sheen: 'sheen 2.4s var(--motion-easing) infinite',
        'grow-x': 'grow-x var(--motion-slower) var(--motion-easing) backwards',
        'grow-y': 'grow-y var(--motion-slower) var(--motion-easing) backwards',
        'ping-soft': 'ping-soft 2s cubic-bezier(0, 0, 0.2, 1) infinite',
        drift: 'drift 12s ease-in-out infinite',
      },

      // Desktop base grid, DS §4
      maxWidth: {
        grid: '1440px',
        form: '640px', // template C reading width
      },
    },
  },
  plugins: [],
};
