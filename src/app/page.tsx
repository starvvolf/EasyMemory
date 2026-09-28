import { redirect } from "next/navigation";

// The learner-facing app is 되짚기 (/study); the earlier main app stays at /legacy as a development tool.
export default function Page() {
  redirect("/study");
}
