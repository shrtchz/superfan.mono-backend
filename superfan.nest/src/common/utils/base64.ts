// export const toDataURL = async (url: string): Promise<string> => {
//   let response: Response;

//   try {
//     response = await fetch(url);
//   } catch (error) {
//     throw new Error('Failed to fetch image');
//   }

//   if (!response.ok) {
//     throw new Error(`Failed to fetch: ${response.statusText}`);
//   }

//   const contentType =
//     response.headers.get('content-type') || 'application/octet-stream';

//   const arrayBuffer = await response.arrayBuffer();
//   const buffer = Buffer.from(arrayBuffer);

//   const base64 = buffer.toString('base64');

//   return `data:${contentType};base64,${base64}`;
// };

import sharp from 'sharp';

export const toDataURL = async (url) => {
  // const response = await fetch(url);
  // const response = await fetch(url) as globalThis.Response;
  // //  const data = await response.json();

  // if (!response.ok) {
  //   throw new Error(`Failed to fetch: ${response.statusText}`);
  // }

  // const arrayBuffer = await response.arrayBuffer();
  const response: globalThis.Response = await fetch(url) as any;
if (!response.ok) {
  throw new Error(`Failed to fetch: ${response.statusText}`);
}
const arrayBuffer = await response.arrayBuffer();
  const inputBuffer = Buffer.from(arrayBuffer);

  // Convert to JPEG
  const jpegBuffer = await sharp(inputBuffer)
    .jpeg({ quality: 90 }) // adjust quality if needed
    .toBuffer();

  const base64 = jpegBuffer.toString('base64');
  return `data:image/jpeg;base64,${base64}`;
};