import { Navigator } from "@/components/navigator";

export default function HomePage() {
  return (
    <>
      {/* 세로(1단): 홈에서는 검색·라이브러리를 본문에 바로 보여준다 */}
      <div className="-mx-4 sm:-mx-8 lg:hidden">
        <Navigator inline />
      </div>
      <div className="hidden h-dvh items-center justify-center text-muted lg:flex">
        왼쪽에서 앨범을 검색하거나 라이브러리에서 고르세요.
      </div>
    </>
  );
}
