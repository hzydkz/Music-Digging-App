import { ImageResponse } from "next/og";
import { RecordIcon } from "@/lib/icon-art";

const SIZES = [192, 512];

export function generateStaticParams() {
  return SIZES.map((s) => ({ size: `${s}.png` }));
}

/** manifest용 아이콘: /icons/192.png, /icons/512.png */
export async function GET(_req: Request, ctx: RouteContext<"/icons/[size]">) {
  const { size } = await ctx.params;
  const n = Number(size.replace(/\.png$/, ""));
  if (!SIZES.includes(n)) return new Response("Not found", { status: 404 });
  return new ImageResponse(<RecordIcon size={n} />, { width: n, height: n });
}
