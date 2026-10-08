import { SiteHeader } from "@/components/site-header";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-8">
      <SiteHeader section="02 / access" />
      <section className="pt-8">
        <h1 className="text-[28px] font-medium leading-snug tracking-tight">Sign in.</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted">
          Dashboard access uses the session cookie. Automation uses a hashed API key sent as a bearer token.
        </p>
        <LoginForm />
      </section>
    </main>
  );
}
