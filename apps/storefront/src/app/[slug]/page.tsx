import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ShopExperience } from './shop-experience';

type Good = {
  id: string | number;
  name: string;
  description: string;
  price: string | number;
  stockCount: number;
};
type Method = { id: string | number; title: string; description: string; logoUrl: string };
export type ShopPageData = {
  id: string;
  title: string;
  slug: string;
  category: string;
  template: string;
  settings: Record<string, string>;
  goods: Good[];
  paymentMethods: Method[];
  deliveryMethods: Method[];
};

export const dynamic = 'force-dynamic';

async function getShop(slug: string): Promise<ShopPageData | null> {
  const apiUrl =
    process.env.API_INTERNAL_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    'http://localhost:4000/api/v1';
  const response = await fetch(`${apiUrl}/public/shops/${encodeURIComponent(slug)}`, {
    cache: 'no-store',
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Не удалось загрузить витрину магазина');
  return response.json() as Promise<ShopPageData>;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const shop = await getShop(slug);
  if (!shop) return { title: 'Магазин не найден' };
  return {
    title: shop.title,
    description:
      shop.settings.heroText ?? `${shop.category}. Каталог товаров магазина ${shop.title}.`,
    alternates: { canonical: `/${shop.slug}` },
    openGraph: {
      title: shop.title,
      description: shop.settings.heroText ?? shop.category,
      type: 'website',
    },
  };
}

export default async function ShopPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const shop = await getShop(slug);
  if (!shop) notFound();
  const accent = shop.settings.accent ?? '#264b3d';
  const heroTitle = shop.settings.heroTitle ?? shop.title;
  const heroText =
    shop.settings.heroText ??
    `${shop.category || 'Товары с заботой о деталях'} — в одном магазине.`;

  return <ShopExperience shop={shop} accent={accent} heroTitle={heroTitle} heroText={heroText} />;
}
