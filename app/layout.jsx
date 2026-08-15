import "./globals.css";

export const metadata = {
  title: "Frido Store Leads",
  description: "Walk-in leads for your store",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
