import { useEffect } from "react";
import { Check, Download, Headphones, Minus, Plus, Square, Trash2, X } from "lucide-react";

import type { InstalledVoicePack, VoicePackManifest } from "../../lib/ipc";
import {
  SPEED_MAX,
  SPEED_MIN,
  SPEED_STEP,
  useTts,
  type SleepChoice,
} from "../../store/tts";
import styles from "./VoicePanel.module.css";

interface VoicePanelProps {
  listening: boolean;
  onToggleListen: () => void;
  onClose: () => void;
}

function formatSize(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} MB`;
}

export function VoicePanel({ listening, onToggleListen, onClose }: VoicePanelProps) {
  const installed = useTts((s) => s.installed);
  const registry = useTts((s) => s.registry);
  const registryError = useTts((s) => s.registryError);
  const downloading = useTts((s) => s.downloading);
  const actionError = useTts((s) => s.actionError);
  const packId = useTts((s) => s.packId);
  const voiceId = useTts((s) => s.voiceId);
  const speed = useTts((s) => s.speed);
  const refresh = useTts((s) => s.refresh);
  const download = useTts((s) => s.download);
  const remove = useTts((s) => s.remove);
  const select = useTts((s) => s.select);
  const setSpeed = useTts((s) => s.setSpeed);
  const sleep = useTts((s) => s.sleep);
  const setSleep = useTts((s) => s.setSleep);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const available = registry.filter(
    (m) => !installed.some((p) => p.id === m.id) || m.id in downloading,
  );

  return (
    <>
      <div className={styles.scrim} onClick={onClose} />
      <div className={styles.panel} role="dialog" aria-label="Listening">
        <div className={styles.head}>
          Listening
          <button type="button" className={styles.iconBtn} onClick={onClose} title="Close">
            <X size={14} strokeWidth={1.4} />
          </button>
        </div>

        <div className={styles.body}>
          {installed.length > 0 && packId && voiceId && (
            <div className={styles.listenRow}>
              <button type="button" className={styles.listenBtn} onClick={onToggleListen}>
                {listening ? (
                  <Square size={14} strokeWidth={1.8} />
                ) : (
                  <Headphones size={15} strokeWidth={1.8} />
                )}
                {listening ? "Stop" : "Listen from this page"}
              </button>
            </div>
          )}

          {installed.length > 0 && (
            <section className={styles.section}>
              <div className={styles.sectionLabel}>On this device</div>
              {installed.map((pack) => (
                <InstalledPackRows
                  key={pack.id}
                  pack={pack}
                  selectedPackId={packId}
                  selectedVoiceId={voiceId}
                  onSelect={select}
                  onRemove={remove}
                />
              ))}
            </section>
          )}

          {installed.length > 0 && (
            <section className={styles.section}>
              <div className={styles.sectionLabel}>Pace</div>
              <div className={styles.speedRow}>
                <button
                  type="button"
                  className={styles.iconBtn}
                  onClick={() => setSpeed(speed - SPEED_STEP)}
                  disabled={speed <= SPEED_MIN}
                  title="Slower"
                >
                  <Minus size={14} strokeWidth={1.8} />
                </button>
                <span className={styles.speedValue}>{speed.toFixed(2).replace(/0$/, "")}×</span>
                <button
                  type="button"
                  className={styles.iconBtn}
                  onClick={() => setSpeed(speed + SPEED_STEP)}
                  disabled={speed >= SPEED_MAX}
                  title="Faster"
                >
                  <Plus size={14} strokeWidth={1.8} />
                </button>
              </div>
            </section>
          )}

          {installed.length > 0 && listening && (
            <section className={styles.section}>
              <div className={styles.sectionLabel}>Sleep</div>
              <div className={styles.sleepRow}>
                {(
                  [
                    ["off", "Off"],
                    ["15", "15m"],
                    ["30", "30m"],
                    ["60", "1h"],
                    ["chapter", "End of chapter"],
                  ] as Array<[SleepChoice, string]>
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={`${styles.sleepBtn} ${sleep === value ? styles.sleepBtnOn : ""}`}
                    onClick={() => setSleep(value)}
                    aria-pressed={sleep === value}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </section>
          )}

          {available.length > 0 && (
            <section className={styles.section}>
              <div className={styles.sectionLabel}>Available to download</div>
              {available.map((manifest) => (
                <AvailablePackRow
                  key={manifest.id}
                  manifest={manifest}
                  progress={downloading[manifest.id]}
                  onDownload={download}
                />
              ))}
            </section>
          )}

          {installed.length === 0 && available.length === 0 && !registryError && (
            <div className={styles.empty}>
              <p className={styles.emptyLead}>Novus can read to you.</p>
              <p className={styles.emptyHint}>Checking for voices…</p>
            </div>
          )}

          {installed.length === 0 && registryError && (
            <div className={styles.empty}>
              <p className={styles.emptyLead}>Novus can read to you.</p>
              <p className={styles.emptyHint}>
                Voices are downloaded once and work offline. Connect to the internet to fetch
                one.
              </p>
            </div>
          )}

          {actionError && <div className={styles.error}>{actionError}</div>}
        </div>
      </div>
    </>
  );
}

interface InstalledPackRowsProps {
  pack: InstalledVoicePack;
  selectedPackId: string | null;
  selectedVoiceId: string | null;
  onSelect: (packId: string, voiceId: string) => void;
  onRemove: (packId: string) => void;
}

function InstalledPackRows({
  pack,
  selectedPackId,
  selectedVoiceId,
  onSelect,
  onRemove,
}: InstalledPackRowsProps) {
  return (
    <div className={styles.pack}>
      {pack.voices.map((voice) => {
        const isActive = selectedPackId === pack.id && selectedVoiceId === voice.id;
        return (
          <button
            key={voice.id}
            type="button"
            className={`${styles.voiceRow} ${isActive ? styles.voiceRowOn : ""}`}
            onClick={() => onSelect(pack.id, voice.id)}
          >
            <span className={styles.voiceName}>{voice.name}</span>
            {isActive && <Check size={14} strokeWidth={2} className={styles.voiceTick} />}
          </button>
        );
      })}
      <div className={styles.packFoot}>
        <span>{formatSize(pack.sizeBytes)}</span>
        <button
          type="button"
          className={styles.removeBtn}
          onClick={() => onRemove(pack.id)}
          title="Remove from this device"
        >
          <Trash2 size={13} strokeWidth={1.7} />
        </button>
      </div>
    </div>
  );
}

interface AvailablePackRowProps {
  manifest: VoicePackManifest;
  progress: number | undefined;
  onDownload: (manifest: VoicePackManifest) => void;
}

function AvailablePackRow({ manifest, progress, onDownload }: AvailablePackRowProps) {
  const isDownloading = progress !== undefined;
  return (
    <div className={styles.available}>
      <div className={styles.availableMain}>
        <div className={styles.availableName}>{manifest.name}</div>
        <div className={styles.availableMeta}>
          {manifest.description} · {formatSize(manifest.sizeBytes)} · {manifest.license}
        </div>
        {isDownloading && (
          <div className={styles.progressTrack}>
            <div className={styles.progressFill} style={{ width: `${(progress ?? 0) * 100}%` }} />
          </div>
        )}
      </div>
      {!isDownloading && (
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => onDownload(manifest)}
          title={`Download (${formatSize(manifest.sizeBytes)})`}
        >
          <Download size={15} strokeWidth={1.7} />
        </button>
      )}
    </div>
  );
}
