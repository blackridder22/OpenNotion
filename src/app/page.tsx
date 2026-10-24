import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createPage, getSidebar } from "@/lib/pages";

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const sidebar = await getSidebar(user.id);
  const first = sidebar.private.find((p) => p.parentId === null) ?? sidebar.shared[0];
  redirect(`/p/${first ? first.id : await createPage(user.id, null, "Untitled")}`);
}
