import { localPublisher } from './publisher.js';

try {
  const result = await localPublisher.publish();
  console.log(`Static site built at ${result.outputDirectory}`);
} catch (error) {
  console.error('Static site build failed; the previous output was preserved.');
  console.error(error);
  process.exitCode = 1;
}
