import { redirect } from "next/navigation";
import { getCachedServerApiContext } from "@/lib/api";
import { OnboardingWizard } from "./onboarding-wizard";

export default async function OnboardingPage() {
  const { user, tenancy } = await getCachedServerApiContext();
  if (!user) {
    redirect("/login?next=/onboarding");
  }
  if (tenancy) {
    redirect("/dashboard");
  }
  return <OnboardingWizard />;
}
