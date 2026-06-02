const url = 'https://open.substack.com/pub/thedankoe/p/how-to-fix-your-entire-life-in-1';

async function test() {
  try {
    const response = await fetch('http://localhost:3001/api/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await response.json();
    if (data.articles && data.articles[0]) {
      const a = data.articles[0];
      const images = a.elements.filter(e => e.type === 'image');
      const embeds = a.elements.filter(e => e.type === 'embed');
      console.log('Total elements:', a.elements.length);
      console.log('Images found:', images.length);
      if (images.length > 0) {
        console.log('First image:', images[0]);
      }
      console.log('Embeds found:', embeds.length);
      if (embeds.length > 0) {
        console.log('First embed:', embeds[0]);
      }
    } else {
      console.log('Error:', data);
    }
  } catch (e) {
    console.error(e);
  }
}
test();
