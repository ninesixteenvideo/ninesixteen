import { compareRecordingLoad, hardwareRecLabel } from "../lib/geometry";
import type { HardwareRecommendation } from "../lib/types";

type Props = {
  orientation: "landscape" | "portrait";
  quality: number;
  fps: number;
  recommendation: HardwareRecommendation | null;
};

export function HardwareRecHint({ orientation, quality, fps, recommendation }: Props) {
  if (!recommendation) {
    return <p className="panel-sub hw-hint hw-hint--pending">Checking your hardware…</p>;
  }

  const compare = compareRecordingLoad(
    orientation,
    quality,
    fps,
    recommendation.maxQuality,
    recommendation.maxFps,
  );
  const tier = hardwareRecLabel(recommendation.maxQuality, recommendation.maxFps);

  return (
    <p className={`panel-sub hw-hint hw-hint--${compare}`}>
      We recommend {tier} for this device
    </p>
  );
}
