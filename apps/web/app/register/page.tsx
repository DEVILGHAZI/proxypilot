import { SiteHeader } from "@/components/site-header";
import { RegisterForm } from "./register-form";

export default function RegisterPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-8">
      <SiteHeader section="02 / access" />
      <section className="pt-8">
        <h1 className="text-[28px] font-medium leading-snug tracking-tight">Create an organization.</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted">
          The first account is the owner. The password is stored as an Argon2id hash. The browser session is an
          HttpOnly cookie.
        </p>
        <RegisterForm />
      </section>
    </main>
  );
}
