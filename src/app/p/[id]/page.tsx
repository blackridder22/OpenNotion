import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getPageWithBlocks, getPath, getRole } from "@/lib/pages";
import { Workspace } from "@/components/Workspace";

export default async function PageRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const role = await getRole(id, user?.id ?? null);
  if (!role) {
    if (!user) redirect(`/login?next=/p/${id}`);
    notFound();
  }
  const data = await getPageWithBlocks(id);
  if (!data) notFound();

  // Breadcrumbs stop at the first ancestor the viewer cannot open.
  const path = await getPath(id);
  const crumbs = [];
  for (const p of path) {
    if (p.id !== id && !(await getRole(p.id, user?.id ?? null))) break;
    crumbs.unshift({ id: p.id, title: p.title, icon: p.icon });
  }

  return (
    <Workspace
      user={user}
      role={role}
      page={{
        id: data.page.id,
        title: data.page.title,
        icon: data.page.icon,
        publicAccess: data.page.publicAccess,
        archived: data.page.archivedAt !== null,
      }}
      blocks={data.blocks}
      subpages={data.children}
      crumbs={crumbs}
    />
  );
}
