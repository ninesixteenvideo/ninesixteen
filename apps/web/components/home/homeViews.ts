export type HomeView =
  | "hero"
  | "download"
  | "pricing"
  | "changelog"
  | "sign-in"
  | "sign-up"
  | "checkout";

export const HOME_VIEW_PARAM = "view";

export function parseHomeView(value: string | null | undefined): HomeView | null {
  if (
    value === "download" ||
    value === "pricing" ||
    value === "changelog" ||
    value === "sign-in" ||
    value === "sign-up" ||
    value === "checkout"
  ) {
    return value;
  }
  return null;
}

export function homeViewFromLegacyPath(pathname: string): HomeView | null {
  if (pathname === "/download") return "download";
  if (pathname === "/pricing") return "pricing";
  if (pathname === "/changelog") return "changelog";
  if (pathname === "/sign-in") return "sign-in";
  if (pathname === "/sign-up") return "sign-up";
  if (pathname === "/checkout") return "checkout";
  return null;
}
