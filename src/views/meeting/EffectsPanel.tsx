import React from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { Ban, Upload } from 'lucide-react';
import { Notice, Switch } from '../../components/ui';
import type { BackgroundProcessorDebugInfo } from './mediaProcessing';

export interface BackgroundOption {
  name: string;
  value: string;
  type: string;
}

const BACKGROUND_PRESETS: BackgroundOption[] = [
  { name: 'None', value: 'none', type: 'none' },
  { name: 'Blur', value: 'blur', type: 'blur' },
  { name: 'Office', value: 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=600&q=80', type: 'image' },
  { name: 'Living Room', value: 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?auto=format&fit=crop&w=600&q=80', type: 'image' },
  { name: 'Abstract', value: 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?auto=format&fit=crop&w=600&q=80', type: 'image' },
  { name: 'Nature', value: 'https://images.unsplash.com/photo-1472214103451-9374bd1c798e?auto=format&fit=crop&w=600&q=80', type: 'image' },
  { name: 'Cafe', value: 'https://images.unsplash.com/photo-1559925393-8be0ec4767c8?auto=format&fit=crop&w=600&q=80', type: 'image' },
];

// The preset names above stay the stable English keys; these are what people read.
const backgroundPresetLabel = (name: string): string => {
  switch (name) {
    case 'None': return t({ id: 'bg_none', message: 'None' });
    case 'Blur': return t({ id: 'bg_blur', message: 'Blur' });
    case 'Office': return t({ id: 'bg_office', message: 'Office' });
    case 'Living Room': return t({ id: 'bg_living_room', message: 'Living Room' });
    case 'Abstract': return t({ id: 'bg_abstract', message: 'Abstract' });
    case 'Nature': return t({ id: 'bg_nature', message: 'Nature' });
    case 'Cafe': return t`Cafe`;
    default: return name;
  }
};

interface EffectsPanelProps {
  virtualBackground: string;
  onSelectBackground: (value: string) => void;
  customBackgrounds: BackgroundOption[];
  onAddCustomBackground: (option: BackgroundOption) => void;
  backgroundProcessingSupported: boolean;
  backgroundProcessorError: string | null;
  debugInfo: BackgroundProcessorDebugInfo | null;
  noiseReductionEnabled: boolean;
  noiseReductionSupported: boolean;
  onNoiseReductionChange: (enabled: boolean) => void;
}

export const EffectsPanel: React.FC<EffectsPanelProps> = ({
  virtualBackground,
  onSelectBackground,
  customBackgrounds,
  onAddCustomBackground,
  backgroundProcessingSupported,
  backgroundProcessorError,
  debugInfo,
  noiseReductionEnabled,
  noiseReductionSupported,
  onNoiseReductionChange,
}) => {
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      if (result) {
        onAddCustomBackground({ name: `Custom ${customBackgrounds.length + 1}`, value: result, type: 'image' });
        onSelectBackground(result);
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="panel__body meffects">
      <section className="grid gap-2">
        <p className="field__label"><Trans>Virtual Backgrounds</Trans></p>
        {!backgroundProcessingSupported && (
          <Notice><Trans>Background effects are not supported in this browser. Filters are still available.</Trans></Notice>
        )}
        {backgroundProcessorError && <Notice variant="error">{backgroundProcessorError}</Notice>}
        {debugInfo && (
          <div className="notice fig block break-all text-xs">
            <p>Background Processor Debug</p>
            <p>support: {String(debugInfo.support)}</p>
            <p>hasLocalParticipant: {String(debugInfo.hasLocalParticipant)}</p>
            <p>hasCameraTrack: {String(debugInfo.hasCameraTrack)}</p>
            <p>activeMode: {debugInfo.activeMode}</p>
            <p>selectedEngine: {debugInfo.selectedEngine}</p>
            <p>fallbackReason: {debugInfo.fallbackReason || 'none'}</p>
            <p>avgInferenceMs: {debugInfo.avgInferenceMs}</p>
            <p>effectiveFps: {debugInfo.effectiveFps}</p>
            <p>lastError: {debugInfo.lastError || 'none'}</p>
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          {[...BACKGROUND_PRESETS, ...customBackgrounds].map((item, idx) => {
            const isSelected = virtualBackground === item.value;
            const isDisabled = !backgroundProcessingSupported && item.value !== 'none';
            const label = backgroundPresetLabel(item.name);
            return (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  if (isDisabled) return;
                  onSelectBackground(item.value);
                }}
                disabled={isDisabled}
                aria-label={label}
                aria-pressed={isSelected}
                className={`bgopt ${isSelected ? 'is-on' : ''} ${isDisabled ? 'opacity-55 cursor-not-allowed' : ''}`}
              >
                <span className="bgopt__pic">
                  {item.type === 'none' && <Ban className="icon" aria-hidden="true" />}
                  {item.type === 'blur' && <span className="mbgblur" aria-hidden="true" />}
                  {item.type === 'image' && <img src={item.value} alt="" loading="lazy" />}
                </span>
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </section>
      <label className={`btn btn--card btn--wide relative focus-within:outline-2 focus-within:outline-focus ${backgroundProcessingSupported ? 'cursor-pointer' : 'opacity-55 cursor-not-allowed'}`}>
        <Upload className="icon" aria-hidden="true" />
        <span><Trans>Upload</Trans></span>
        <input
          type="file"
          accept="image/*"
          onChange={handleFileUpload}
          disabled={!backgroundProcessingSupported}
          className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-not-allowed"
        />
      </label>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="field__label"><Trans>Noise Reduction</Trans></p>
          <p className="muted text-xs"><Trans>Filters background noise for clearer audio.</Trans></p>
        </div>
        <Switch
          checked={noiseReductionEnabled}
          onChange={onNoiseReductionChange}
          label={t`Noise Reduction`}
          disabled={!noiseReductionSupported}
        />
      </div>
    </div>
  );
};
