const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 3000; // You can choose any available port
const filePath = path.join(__dirname, 'filetoupdate.txt'); // Path to the file

// Middleware to parse URL-encoded bodies (as sent by HTML forms)
app.use(express.urlencoded({ extended: true }));

// --- Routes ---

// Serve the HTML form on the root URL ('/')
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Handle the form submission on POST request to '/submit'
app.post('/submit', (req, res) => {
  const textInput = req.body.textInput; // Get data from the input field named 'textInput'

  if (typeof textInput !== 'string') {
    return res.status(400).send('Invalid input data.');
  }

  console.log(`Received text: ${textInput}`);
  console.log(`Attempting to write to: ${filePath}`);

  // Write the text to the file, overwriting existing content
  fs.writeFile(filePath, textInput, (err) => {
    if (err) {
      console.error("Error writing to file:", err);
      // Send an error response back to the browser
      return res.status(500).send('Error writing to file. Check server logs.');
    }
    console.log(`Successfully updated ${path.basename(filePath)}`);
    // Send a success response back to the browser
    // You could also redirect back to the form: res.redirect('/');
    res.send(`
      <h1>File Updated Successfully!</h1>
      <p>Content written to ${path.basename(filePath)}:</p>
      <pre>${textInput}</pre>
      <br>
      <a href="/">Go back</a>
    `);
  });
});

// --- Start the Server ---
app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
  // Check if file exists on startup, create if not
  if (!fs.existsSync(filePath)) {
    fs.writeFile(filePath, 'Initial content.', (err) => {
      if (err) {
        console.error("Could not create initial file:", err);
      } else {
        console.log(`Created ${path.basename(filePath)}.`);
      }
    });
  } else {
     console.log(`${path.basename(filePath)} already exists.`);
  }
});