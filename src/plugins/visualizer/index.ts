import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import emptyStyle from './empty-player.css?inline';
import {
  ButterchurnVisualizer as butterchurn,
  VudioVisualizer as vudio,
  WaveVisualizer as wave,
} from './visualizers';
import { unwrapButterchurnPresets } from './visualizers/butterchurn-presets-interop';
import { type Visualizer } from './visualizers/visualizer';

import type { RendererContext } from '@/types/contexts';
import type { MusicPlayer } from '@/types/music-player';

type WaveColor = {
  gradient: string[];
  rotate?: number;
};

// Fixed choices only: Electron native menus can't take free-text numeric input.
const CYCLE_INTERVAL_CHOICES_SECONDS = [0, 15, 30, 60, 120, 300, 600] as const;

// TEMP-DEBUG: everything tagged TEMP-DEBUG is a throwaway dev aid for
// verifying preset-change attribution and gets stripped before the PR.
type PresetChangeReason = 'manual' | 'interval' | 'song-change';
const PRESET_CHANGE_REASON_LABELS: Record<PresetChangeReason, string> = {
  'manual': 'manually chosen',
  'interval': 'timer cycle',
  'song-change': 'new song',
};

export type VisualizerPluginConfig = {
  enabled: boolean;
  type: 'butterchurn' | 'vudio' | 'wave';
  butterchurn: {
    preset: string;
    blendTimeInSeconds: number;
    cycle: {
      // 0 disables interval-based cycling
      intervalSeconds: (typeof CYCLE_INTERVAL_CHOICES_SECONDS)[number];
      onSongChange: boolean;
    };
    // TEMP-DEBUG
    notifyOnPresetChange: boolean;
    // TEMP-DEBUG
    lastPresetChangeReason: PresetChangeReason;
  };
  vudio: {
    effect: string;
    accuracy: number;
    lighting: {
      maxHeight: number;
      maxSize: number;
      lineWidth: number;
      color: string;
      shadowBlur: number;
      shadowColor: string;
      fadeSide: boolean;
      prettify: boolean;
      horizontalAlign: string;
      verticalAlign: string;
      dottify: boolean;
    };
  };
  wave: {
    animations: {
      type: string;
      config: {
        bottom?: boolean;
        top?: boolean;
        count?: number;
        cubeHeight?: number;
        lineWidth?: number;
        diameter?: number;
        fillColor?: string | WaveColor;
        lineColor?: string | WaveColor;
        radius?: number;
        frequencyBand?: string;
      };
    }[];
  };
};

type RenderProps = {
  visualizerInstance: Visualizer | null;
  audioContext: AudioContext | null;
  audioSource: MediaElementAudioSourceNode | null;
  observer: ResizeObserver | null;
  lastConfig: VisualizerPluginConfig | null;
  cycleTimer: ReturnType<typeof setInterval> | null;
  setConfig: RendererContext<VisualizerPluginConfig>['setConfig'] | null;
  onSongChanged: (() => void) | null;
};

// Explicit `this` typing sidesteps fragile self-referential inference of the
// generic `RendererPluginLifecycle` `This` type for our own custom methods.
type RendererThis = {
  props: RenderProps;
  createVisualizer: (config: VisualizerPluginConfig) => void;
  reconcileCycleTimer: (config: VisualizerPluginConfig) => void;
  cyclePreset: (reason: 'interval' | 'song-change') => Promise<void>;
};

let cachedPresetNamesPromise: Promise<string[]> | null = null;

// This module also loads in the Electron main process, to build the native
// menu below, where there's no `self` global — but `butterchurn-presets`'
// bundled UMD output assumes one exists. Import it dynamically, only when a
// preset name list is actually needed, polyfilling `self` first; cached
// since both the menu and cycling call this repeatedly.
const getButterchurnPresetNames = (): Promise<string[]> => {
  cachedPresetNamesPromise ??= (async () => {
    const globalWithSelf = globalThis as unknown as { self?: unknown };
    globalWithSelf.self ??= globalThis;

    const [base, extra] = await Promise.all([
      import('butterchurn-presets/dist/base.js'),
      import('butterchurn-presets/dist/extra.js'),
    ]);
    const presets = {
      ...unwrapButterchurnPresets(base),
      ...unwrapButterchurnPresets(extra),
    };
    return Object.keys(presets).sort((a, b) => a.localeCompare(b));
  })();
  return cachedPresetNamesPromise;
};

const pickRandomPreset = (presetNames: string[], excluding: string): string => {
  if (presetNames.length <= 1) return presetNames[0] ?? excluding;

  let next: string;
  do {
    next = presetNames[Math.floor(Math.random() * presetNames.length)]!;
  } while (next === excluding);
  return next;
};

export default createPlugin({
  name: () => t('plugins.visualizer.name'),
  description: () => t('plugins.visualizer.description'),
  restartNeeded: false,
  config: {
    enabled: false,
    type: 'butterchurn',
    // Config per visualizer
    butterchurn: {
      preset: 'martin [shadow harlequins shape code] - fata morgana',
      blendTimeInSeconds: 2.7,
      cycle: {
        intervalSeconds: 0,
        onSongChange: false,
      },
      // TEMP-DEBUG
      notifyOnPresetChange: false,
      // TEMP-DEBUG
      lastPresetChangeReason: 'manual',
    },
    vudio: {
      effect: 'lighting',
      accuracy: 128,
      lighting: {
        maxHeight: 160,
        maxSize: 12,
        lineWidth: 1,
        color: '#49f3f7',
        shadowBlur: 2,
        shadowColor: 'rgba(244,244,244,.5)',
        fadeSide: true,
        prettify: false,
        horizontalAlign: 'center',
        verticalAlign: 'middle',
        dottify: true,
      },
    },
    wave: {
      animations: [
        {
          type: 'Cubes',
          config: {
            bottom: true,
            count: 30,
            cubeHeight: 5,
            fillColor: { gradient: ['#FAD961', '#F76B1C'] },
            lineColor: 'rgba(0,0,0,0)',
            radius: 20,
          },
        },
        {
          type: 'Cubes',
          config: {
            top: true,
            count: 12,
            cubeHeight: 5,
            fillColor: { gradient: ['#FAD961', '#F76B1C'] },
            lineColor: 'rgba(0,0,0,0)',
            radius: 10,
          },
        },
        {
          type: 'Circles',
          config: {
            lineColor: {
              gradient: ['#FAD961', '#FAD961', '#F76B1C'],
              rotate: 90,
            },
            lineWidth: 4,
            diameter: 20,
            count: 10,
            frequencyBand: 'base',
          },
        },
      ],
    },
  } as VisualizerPluginConfig,
  stylesheets: [emptyStyle],
  menu: async ({ getConfig, setConfig, refresh }) => {
    const config = await getConfig();
    const visualizerTypes = ['butterchurn', 'vudio', 'wave'] as const; // For bundling
    const presetNames = await getButterchurnPresetNames();

    return [
      {
        label: t('plugins.visualizer.menu.visualizer-type'),
        submenu: visualizerTypes.map((visualizerType) => ({
          label: visualizerType,
          type: 'radio',
          checked: config.type === visualizerType,
          async click() {
            await setConfig({ type: visualizerType });
            await refresh();
          },
        })),
      },
      {
        label: t('plugins.visualizer.menu.butterchurn-preset'),
        submenu: presetNames.map((presetName) => ({
          label: presetName,
          type: 'radio',
          checked: config.butterchurn.preset === presetName,
          async click() {
            await setConfig({
              butterchurn: {
                ...config.butterchurn,
                preset: presetName,
                lastPresetChangeReason: 'manual', // TEMP-DEBUG
              },
            });
            await refresh();
          },
        })),
      },
      {
        label: t('plugins.visualizer.menu.butterchurn-cycle-interval'),
        submenu: CYCLE_INTERVAL_CHOICES_SECONDS.map((seconds) => ({
          label:
            seconds === 0
              ? t('plugins.visualizer.menu.butterchurn-cycle-off')
              : seconds < 60
                ? `${seconds}s`
                : `${seconds / 60}m`,
          type: 'radio',
          checked: config.butterchurn.cycle.intervalSeconds === seconds,
          async click() {
            await setConfig({
              butterchurn: {
                ...config.butterchurn,
                cycle: {
                  ...config.butterchurn.cycle,
                  intervalSeconds: seconds,
                },
              },
            });
            await refresh();
          },
        })),
      },
      {
        label: t('plugins.visualizer.menu.butterchurn-cycle-on-song-change'),
        type: 'checkbox',
        checked: config.butterchurn.cycle.onSongChange,
        async click() {
          await setConfig({
            butterchurn: {
              ...config.butterchurn,
              cycle: {
                ...config.butterchurn.cycle,
                onSongChange: !config.butterchurn.cycle.onSongChange,
              },
            },
          });
          await refresh();
        },
      },
      // TEMP-DEBUG: strip this whole menu item before the PR
      {
        label: 'Show Visualizer Changes',
        type: 'checkbox',
        checked: config.butterchurn.notifyOnPresetChange,
        async click() {
          await setConfig({
            butterchurn: {
              ...config.butterchurn,
              notifyOnPresetChange: !config.butterchurn.notifyOnPresetChange,
            },
          });
          await refresh();
        },
      },
    ];
  },

  renderer: {
    props: {
      visualizerInstance: null,
      audioContext: null,
      audioSource: null,
      observer: null,
      lastConfig: null,
      cycleTimer: null,
      setConfig: null,
      onSongChanged: null,
    } as RenderProps,

    async start(
      this: RendererThis,
      context: RendererContext<VisualizerPluginConfig>,
    ) {
      this.props.setConfig = context.setConfig;

      const config = await context.getConfig();
      this.props.lastConfig = config;
      this.reconcileCycleTimer(config);
    },

    reconcileCycleTimer(this: RendererThis, config: VisualizerPluginConfig) {
      if (this.props.cycleTimer) {
        clearInterval(this.props.cycleTimer);
        this.props.cycleTimer = null;
      }

      const intervalSeconds =
        config.enabled && config.type === 'butterchurn'
          ? config.butterchurn.cycle.intervalSeconds
          : 0;
      if (!intervalSeconds) return;

      this.props.cycleTimer = setInterval(() => {
        this.cyclePreset('interval');
      }, intervalSeconds * 1000);
    },

    async cyclePreset(this: RendererThis, reason: 'interval' | 'song-change') {
      const config = this.props.lastConfig;
      if (!config || config.type !== 'butterchurn' || !this.props.setConfig) {
        return;
      }

      const presetNames = await getButterchurnPresetNames();
      const nextPreset = pickRandomPreset(
        presetNames,
        config.butterchurn.preset,
      );
      this.props.setConfig({
        butterchurn: {
          ...config.butterchurn,
          preset: nextPreset,
          lastPresetChangeReason: reason, // TEMP-DEBUG
        },
      });
    },

    createVisualizer(this: RendererThis, config: VisualizerPluginConfig) {
      this.props.visualizerInstance?.destroy();
      this.props.visualizerInstance = null;

      if (!this.props.audioContext || !this.props.audioSource) return;
      if (!config.enabled) return;

      const video = document.querySelector<
        HTMLVideoElement & { captureStream(): MediaStream }
      >('video');
      if (!video) {
        return;
      }

      const visualizerContainer =
        document.querySelector<HTMLElement>('#player');
      if (!visualizerContainer) {
        return;
      }

      let canvas = document.querySelector<HTMLCanvasElement>('#visualizer');
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.id = 'visualizer';
        visualizerContainer?.prepend(canvas);
      }

      const gainNode = this.props.audioContext.createGain();
      gainNode.gain.value = 1.25;
      this.props.audioSource.connect(gainNode);

      let visualizerType: {
        new (...args: ConstructorParameters<typeof vudio>): Visualizer;
      } = vudio;
      if (config.type === 'wave') {
        visualizerType = wave;
      } else if (config.type === 'butterchurn') {
        visualizerType = butterchurn;
      }
      this.props.visualizerInstance = new visualizerType(
        this.props.audioContext,
        this.props.audioSource,
        canvas,
        gainNode,
        video.captureStream(),
        config,
      );

      const resizeVisualizer = () => {
        if (canvas && visualizerContainer) {
          const { width, height } =
            window.getComputedStyle(visualizerContainer);
          canvas.width = Math.ceil(parseFloat(width));
          canvas.height = Math.ceil(parseFloat(height));
        }
        this.props.visualizerInstance?.resize(canvas.width, canvas.height);
      };
      resizeVisualizer();

      this.props.observer?.disconnect();
      this.props.observer = new ResizeObserver(resizeVisualizer);
      this.props.observer.observe(visualizerContainer);
    },

    onConfigChange(this: RendererThis, newConfig: VisualizerPluginConfig) {
      const prevConfig = this.props.lastConfig;
      this.props.lastConfig = newConfig;

      const instance = this.props.visualizerInstance;
      const canLiveUpdatePreset =
        newConfig.enabled &&
        instance instanceof butterchurn &&
        prevConfig?.type === 'butterchurn' &&
        newConfig.type === 'butterchurn';

      if (canLiveUpdatePreset) {
        const prevButterchurn = prevConfig.butterchurn;
        const nextButterchurn = newConfig.butterchurn;
        if (
          prevButterchurn.preset !== nextButterchurn.preset ||
          prevButterchurn.blendTimeInSeconds !==
            nextButterchurn.blendTimeInSeconds
        ) {
          instance.setPreset(
            nextButterchurn.preset,
            nextButterchurn.blendTimeInSeconds,
          );
        }
      } else {
        this.createVisualizer(newConfig);
      }

      // TEMP-DEBUG: strip this whole block before the PR
      if (
        newConfig.type === 'butterchurn' &&
        newConfig.butterchurn.notifyOnPresetChange &&
        prevConfig?.type === 'butterchurn' &&
        prevConfig.butterchurn.preset !== newConfig.butterchurn.preset
      ) {
        try {
          new Notification('Visualizer preset changed', {
            body: `${newConfig.butterchurn.preset}\n(${
              PRESET_CHANGE_REASON_LABELS[
                newConfig.butterchurn.lastPresetChangeReason
              ]
            })`,
          });
        } catch {}
      }

      this.reconcileCycleTimer(newConfig);
    },

    onPlayerApiReady(
      this: RendererThis,
      _: MusicPlayer,
      { getConfig }: RendererContext<VisualizerPluginConfig>,
    ) {
      document.addEventListener(
        'peard:audio-can-play',
        async (e) => {
          this.props.audioContext = e.detail.audioContext;
          this.props.audioSource = e.detail.audioSource;
          this.createVisualizer(await getConfig());
        },
        { passive: true },
      );

      const video = document.querySelector<HTMLVideoElement>('video');
      if (video) {
        this.props.onSongChanged = () => {
          const config = this.props.lastConfig;
          if (
            config?.type === 'butterchurn' &&
            config.butterchurn.cycle.onSongChange
          ) {
            this.cyclePreset('song-change');
          }
        };
        video.addEventListener('peard:src-changed', this.props.onSongChanged);
      }
    },

    stop(this: RendererThis) {
      if (this.props.cycleTimer) {
        clearInterval(this.props.cycleTimer);
        this.props.cycleTimer = null;
      }

      const video = document.querySelector<HTMLVideoElement>('video');
      if (video && this.props.onSongChanged) {
        video.removeEventListener(
          'peard:src-changed',
          this.props.onSongChanged,
        );
      }
      this.props.onSongChanged = null;

      this.props.observer?.disconnect();
      this.props.observer = null;

      this.props.visualizerInstance?.destroy();
      this.props.visualizerInstance = null;
    },
  },
});
