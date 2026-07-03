import EventScreen from "@/components/EventScreen";

export default async function EventPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ welcome?: string }>;
}) {
  const { id } = await params;
  const { welcome } = await searchParams;
  return <EventScreen eventId={id} welcome={welcome === "1"} />;
}
