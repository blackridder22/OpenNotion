import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AuthForm } from "@/components/AuthForm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  // Only follow local paths after sign-in.
  const target = next?.startsWith("/") && !next.startsWith("//") ? next : "/";
  if (await getCurrentUser()) redirect(target);
  return <AuthForm next={target} />;
}
