import MerchantHandshake from "@/components/MerchantHandshake";

export const metadata = {
  title: "Merchant handshake",
};

export default function MerchantCheck() {
  return (
    <main className="mx-auto w-full max-w-2xl px-3 py-6 sm:px-4 sm:py-10">
      <MerchantHandshake />
    </main>
  );
}
