import { permanentRedirect } from "next/navigation";

export default function CheckoutPage() {
  permanentRedirect("/?view=checkout");
}
