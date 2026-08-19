import './styles/globals.css';

export const metadata = {
  title: 'มิเตอร์ไฟ — ค่าไฟ THB',
  description: 'ดูการใช้ไฟฟ้าจากมิเตอร์ Tuya แบบเรียลไทม์ พร้อมค่าไฟตามสูตร MEA',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '32x32' },
      { url: '/icon-192-light.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: ['/apple-touch-icon.png'],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'มิเตอร์ไฟ',
  },
};

export const viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafaf7' },
    { media: '(prefers-color-scheme: dark)', color: '#101112' },
  ],
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="th">
      <body>{children}</body>
      <script
        dangerouslySetInnerHTML={{
          __html: `if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})})}`
        }}
      />
    </html>
  );
}
