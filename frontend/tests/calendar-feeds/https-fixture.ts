import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import type { ClientRequest, IncomingMessage } from "node:http";
import type { FetchDeps } from "@/lib/calendar-feeds/fetch";

/** Models the request's lookup-to-connect path without opening a network socket. */
export function httpsFixture(
  respond: (url: URL) => Response | Promise<Response>,
  connect: (address: string) => void = () => {},
  systemLookup: () => string = () => "127.0.0.1",
): FetchDeps["requestHttps"] {
  return (url, options, onResponse) => {
    const request = new EventEmitter();
    let incoming: IncomingMessage | undefined;
    const abort = () => {
      const error = new DOMException("aborted", "AbortError");
      incoming?.destroy(error);
      request.emit("error", error);
    };
    Object.assign(request, {
      end() {
        queueMicrotask(async () => {
          try {
            const address = await new Promise<string>((resolve, reject) => {
              if (!options.lookup) return resolve(systemLookup());
              options.lookup(url.hostname, { all: false }, (error, address) => {
                if (error) reject(error);
                // SAFETY: all:false selects the single-address callback overload.
                else resolve(address as string);
              });
            });
            connect(address);
            const response = await respond(url);
            // SAFETY: Bun streams are async iterable. This fixture supplies the IncomingMessage fields the transport reads.
            incoming = Object.assign(
              response.body ? Readable.from(response.body as unknown as AsyncIterable<Uint8Array>) : Readable.from([]),
              { statusCode: response.status, headers: Object.fromEntries(response.headers) },
            ) as IncomingMessage;
            incoming.once("close", () => options.signal?.removeEventListener("abort", abort));
            onResponse(incoming);
          } catch (error) {
            request.emit("error", error);
          }
        });
      },
    });
    options.signal?.addEventListener("abort", abort, { once: true });
    // SAFETY: The transport only calls end() and subscribes to request events.
    return request as ClientRequest;
  };
}
