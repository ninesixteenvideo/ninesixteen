import { Wordmark, type WordmarkProps } from "@ninesixteen/brand/Wordmark";

type WordmarkTvProps = WordmarkProps & {
  /** Extra class on the TV interference wrapper. */
  wrapClassName?: string;
};

/** Brand wordmark with always-on scan hum + burst glitch via `body.site-tv-burst`. */
export function WordmarkTv({ wrapClassName, className, ...props }: WordmarkTvProps) {
  return (
    <span className={["ns-wm-tv", wrapClassName].filter(Boolean).join(" ")}>
      <span className="ns-wm-tv__scan" aria-hidden />
      <Wordmark {...props} className={["ns-wm-tv__mark", className].filter(Boolean).join(" ")} />
    </span>
  );
}
