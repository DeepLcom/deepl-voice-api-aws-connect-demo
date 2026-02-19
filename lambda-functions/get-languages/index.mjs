export const handler = async (event) => {
  const deeplApiKey = process.env.DEEPL_API_KEY;
  console.log(event)

  let body;
  if (typeof event.body === 'string') {
    body = JSON.parse(event.body);
  } else {
    body = event.body;
  }
  const type = body.type || 'source';

  try {
    const response = await fetch(`https://api.deepl.com/v2/languages?type=${type}`, {
      method: 'GET',
      headers: {
        'Authorization': `DeepL-Auth-Key ${deeplApiKey}`
      }
    });

    const data = await response.json();

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ languages: data })
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};