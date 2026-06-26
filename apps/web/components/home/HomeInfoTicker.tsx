import { HOME_TICKER_ITEMS } from "@/lib/site";
import { LATEST_VERSION } from "@/content/releases";

const TICKER_COPIES = 2;

/** Never-ending broadcast strip — features & product facts across the top of the landing page. */
export function HomeInfoTicker() {
  return (
    <div className="home-ticker" aria-hidden>
      <div className="home-ticker__live">
        <span className="home-ticker__dot" />
        v{LATEST_VERSION}
      </div>
      <div className="home-ticker__track">
        <div className="home-ticker__marquee">
          {Array.from({ length: TICKER_COPIES }).map((_, copy) => (
            <span key={copy} className="home-ticker__row">
              {HOME_TICKER_ITEMS.map((item) => (
                <span key={`${copy}-${item}`} className="home-ticker__item">
                  <span>{item}</span>
                  <span className="home-ticker__sep" aria-hidden>
                    ◆
                  </span>
                </span>
              ))}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
