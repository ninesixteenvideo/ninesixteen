import { compareRecordingLoad, hardwareRecLabel } from "../lib/geometry";
import type { HardwareRecommendation } from "../lib/types";
import { Reveal } from "./Reveal";

type Props = {
  orientation: "landscape" | "portrait";
  quality: number;
  fps: number;
  recommendation: HardwareRecommendation | null;
};

export function HardwareRecHint({ orientation, quality, fps, recommendation }: Props) {
  const compare = recommendation
    ? compareRecordingLoad(
        orientation,
        quality,
        fps,
        recommendation.maxQuality,
        recommendation.maxFps,
      )
    : null;
  const tier = recommendation
    ? hardwareRecLabel(recommendation.maxQuality, recommendation.maxFps)
    : "";

  return (
    <>
      <Reveal show={!recommendation}>
        <p className="panel-sub hw-hint hw-hint--pending">Checking your hardware…</p>
      </Reveal>
      <Reveal show={Boolean(recommendation)}>
        <p className={`panel-sub hw-hint hw-hint--${compare}`}>
          We recommend {tier} for this device
        </p>
      </Reveal>
    </>
  );
}
