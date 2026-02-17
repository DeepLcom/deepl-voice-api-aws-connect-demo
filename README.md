# Amazon Connect With DeepL Voice to Voice (V2V) Translation

## Here's a high-level overview of how the solution works:

1. Speech Recognition: The customer's spoken language is captured and converted into text, translated into the agent's preferred language, and converted back into speech using DeepL Voice2Voice API.
2. Bidirectional Translation: The process is reversed for the agent's response, translating their speech into the customer's language and delivering the translated audio to the customer.
3. Seamless Integration: The Voice to Voice translation sample project integrates with Amazon Connect, enabling agents to handle customer interactions in multiple languages without any additional effort or training, using the below libraries:
   - [**Amazon Connect Streams JS**](https://github.com/amazon-connect/amazon-connect-streams):
     - Integrate your existing web applications with Amazon Connect
     - Embed Contact Control Panel (CCP) into a web page
     - Use the default built-in interface, or build your own from scratch
   - [**Amazon Connect RTC JS**](https://github.com/aws/connect-rtc-js):
     - Provides softphone support to Amazon Connect
     - Implements Amazon Connect WebRTC protocol and integrates with browser WebRTC APIs
     - Simple contact session interface which can be integrated with Amazon Connect Streams JS
     - In a typical Amazon Connect Streams JS integration, Amazon Connect RTC JS is not required
     - In this sample project, Amazon Connect RTC JS provides access to Amazon Connect WebRTC Media Streams
   - These 2 libraries are imported into Demo Webapp, without any modifications/customisations.

### Key limitations

- Webapp Authentication is implemented via simple redirect to Amazon Cognito Managed Login Page(s)
- Due to CORS, Web application accesses DeepL API via AWS Lambda function URL.
- Both Agent Audio and Customer Audio are transcribed locally (agent's browser opening 2 websocket connections to Amazon Transcribe), therefore agent PC performance and network bandwidth need to be checked
- The demo Webapp provides a full control on Voice to Voice setup (i.e. selecting From and To languages, voices, etc). These parameters would normally be set based on Amazon Connect Contact Attributes
- The sample project has not been tested with outbound calls, conference or transfers
- The sample project has not been tested in combination with other channels, such as chat, tasks, email

## Solution architecture:

### Typical Amazon Connect CCP embedded to a custom webapp

![Amazon Connect CCP embedded](diagrams/AmazonConnectV2V-EmbeddedCCP.png)

### Amazon Connect Voice 2 Voice architecture:

This application takes the audio from the Agent microphone and Customer phone audio and pushes it through Deepl Voice2Voice API for transcriptions, translation and synthesized audio based on selected languages and delivers translated synthesized audio back to the Agent and Customer.

## Solution setup

For detailed deployment instructions, solution components, and configuration details, please refer to the [Setup Guide](SETUP.md).

## Demo UI Guide

For detailed instructions on navigating the demo web application, configuring transcription/translation settings, and understanding the user interface, please refer to the [Demo Guide](DEMO.md).

## License

This library is licensed under the MIT-0 License. See the LICENSE file.
