import { redirect } from "next/navigation";

// 앱은 /study 하나(Recaller).
export default function Page() {
  redirect("/study");
}
