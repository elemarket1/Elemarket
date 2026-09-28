import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "ELEMARKET — Shop Ghana" },
      { name: "description", content: "A modern Ghana marketplace for food, fashion, electronics, groceries and more." },
      { name: "theme-color", content: "#0b3d2e" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" },
      { rel: "stylesheet", href: appCss },
    ],
  }),
  component: () => (
    <html lang="en" suppressHydrationWarning>
      <head><HeadContent /></head>
      <body>
        <AuthProvider><Outlet /></AuthProvider>
        <Scripts />
      </body>
    </html>
  ),
});
