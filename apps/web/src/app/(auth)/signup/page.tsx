import { redirect } from "next/navigation";

/**
 * Public signup is closed: a researcher gets into SplicR because a lab invited
 * their address. The route is kept as a redirect rather than deleted so that
 * old links, bookmarks and anything still pointing here land on the sign-in
 * page instead of a 404 that looks like the product is broken.
 *
 * This is a convenience, not a control. Account creation is refused in the
 * database, so removing this file would change nothing about who can sign up.
 */
export default function SignupPage() {
  redirect("/login");
}
