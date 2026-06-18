type JsonLdProps = {
  data: Record<string, unknown> | readonly Record<string, unknown>[];
};

export function JsonLd({ data }: JsonLdProps) {
  const blocks = Array.isArray(data) ? data : [data];
  return (
    <>
      {blocks.map((block) => (
        <script
          key={JSON.stringify(block["@type"] ?? block)}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(block) }}
        />
      ))}
    </>
  );
}
