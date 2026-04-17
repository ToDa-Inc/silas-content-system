import { redirect } from "next/navigation";

/**
 * The Create flow has been merged into Generate. Old `/create` URLs (and any
 * external links from Intelligence or older docs) now land on the unified
 * `/generate` page where approved sessions automatically open the video pipeline.
 */
export default function LegacyCreatePage(): never {
  redirect("/generate");
}
