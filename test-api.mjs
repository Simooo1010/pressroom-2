// Quick API test script
const url = 'https://rawandferal.substack.com/p/the-game-theory-of-1-margarita-night';

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
      console.log('=== PARSE SUCCESS ===');
      console.log('Title:', a.title);
      console.log('Author:', a.author);
      console.log('Publication:', a.publicationName);
      console.log('Date:', a.date);
      console.log('Hero Image:', a.heroImage ? 'Yes' : 'No');
      console.log('Elements count:', a.elements.length);
      console.log('Element types:', [...new Set(a.elements.map(e => e.type))].join(', '));
      console.log('First 5 elements:');
      a.elements.slice(0, 5).forEach((el, i) => {
        const preview = el.content ? el.content.substring(0, 80) + '...' : JSON.stringify(el).substring(0, 80);
        console.log(`  [${i}] ${el.type}: ${preview}`);
      });
    } else {
      console.log('ERROR: No articles returned');
      console.log(JSON.stringify(data, null, 2));
    }
  } catch (err) {
    console.error('FETCH ERROR:', err.message);
  }
}

test();
