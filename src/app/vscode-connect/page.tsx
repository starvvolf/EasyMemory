import { Suspense } from "react";
import VscodeConnectClient from "./VscodeConnectClient";

export default function VscodeConnectPage() {
  return (
    <Suspense fallback={<ConnectShell>연결 요청을 확인하는 중입니다.</ConnectShell>}>
      <VscodeConnectClient />
    </Suspense>
  );
}

function ConnectShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-[#313338] px-5 text-[#F2F3F5]">
      <section className="w-full max-w-lg rounded-lg border border-[#3F4147] bg-[#2B2D31] p-6 shadow-xl">
        {children}
      </section>
    </main>
  );
}
