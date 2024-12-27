const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const path = require("path");
const express = require("express");
require("dotenv").config();
const mongoose = require("mongoose");
const { User, Book, Reservation } = require("./models");
const app = express();
app.use(express.json());
const port = process.env.PORT || 5000;

// Replace with your bot's API token
const token = process.env.TOKEN; // Update with your token
const bot = new TelegramBot(token); // No polling
const librarianChatId = process.env.LIBRARIAN_CHAT_ID.trim(); // Set this to the logged chat ID

// Book categories and reservations
let books = {
  Arabic: { aqida: [], fiqh: [] },
  Amharic: { aqida: [], fiqh: [] },
  AfaanOromo: { aqida: [], fiqh: [] },
};

let reservations = {};
let users = {};
let userLanguages = {};

// Load data from JSON files
const booksFilePath = path.join(__dirname, "books.json");
const reservationsFilePath = path.join(__dirname, "reservations.json");

function loadBooks() {
  if (fs.existsSync(booksFilePath)) {
    const data = fs.readFileSync(booksFilePath);
    return JSON.parse(data);
  }
  return {};
}

function loadReservations() {
  if (fs.existsSync(reservationsFilePath)) {
    const data = fs.readFileSync(reservationsFilePath);
    return JSON.parse(data);
  }
  return {};
}

// Function to save books to a JSON file
function saveBooks() {
  fs.writeFile("books.json", JSON.stringify(books, null, 2), (err) => {
    if (err) {
      console.error("Error saving book:", err);
    } else {
      console.log("Books saved successfully.");
    }
  });
}

function saveReservations() {
  fs.writeFile(
    "reservations.json",
    JSON.stringify(reservations, null, 2),
    (err) => {
      if (err) {
        console.error("Error saving reservations:", err);
      } else {
        console.log("Reservations saved successfully.");
      }
    }
  );
}

function findBookById(language, bookId) {
  console.log(`Searching for book ID ${bookId} in language ${language}`);
  if (!books[language]) {
    console.log(`No books found for language: ${language}`);
    return null;
  }
  for (const category in books[language]) {
    console.log(`Checking category: ${category}`);
    const book = books[language][category].find(
      (b) => b.id == parseInt(bookId, 10)
    );
    if (book) {
      console.log(`Found book: ${book.title}`);
      return book;
    }
  }
  console.log(`No book found with ID ${bookId}`);
  return null; // Return null if no book is found
}
// === Initialize Data ===
books = loadBooks();
reservations = loadReservations();

// Start command

// Handle user selections from the main menu

// Function to display user reservations
function showUserReservations(chatId) {
  const userReservations = reservations[chatId] || [];
  if (userReservations.length === 0) {
    bot.sendMessage(chatId, "You have no reservations.");
    return;
  }

  const reservationList = userReservations
    .map((res) => `- "${res.title}" (Pickup: ${res.pickupTime})`)
    .join("\n");

  bot.sendMessage(chatId, `Your Reservations:\n${reservationList}`);
}

// Function to display help
function displayHelp(chatId) {
  const helpMessage = `
Welcome to the Library Booking Bot! Here are the commands you can use:

- Register: Register your name and phone number.
- My Reservations: View your current reservations.
- Change Language: Change your selected language.
- Help: Get assistance with commands.
- Exit: Exit the bot.

If you need further assistance, feel free to ask!
  `;
  bot.sendMessage(chatId, helpMessage);
}
// Registration logic

async function connectToDatabase() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 25000,
    });
    console.log("MongoDB connected!");
  } catch (error) {
    console.error("MongoDB connection error:", error);
    setTimeout(connectToDatabase, 5000); // Retry after 5 seconds
  }
}

connectToDatabase();

bot.onText(/\/start/, (msg) => {
  console.log("hi start");
  const chatId = msg.chat.id;
  const welcomeMessage = `
      ================---==============
    Welcome to the KJUMJ IRSHAD Library Booking Bot! 📚
    Please register to get started by typing /register.
    
    For a list of all commands and guidance, type /help.
    ================---==============
    `;
  bot
    .sendMessage(chatId, welcomeMessage)
    .then(() => console.log("Welcome message sent to:", chatId))
    .catch((err) => console.error("Error sending welcome message:", err));
});

let registrationState = {};

bot.onText(/\/register/, (msg) => {
  const chatId = msg.chat.id;
  if (registrationState[chatId]) {
    return bot.sendMessage(
      chatId,
      "You are already in the registration process."
    );
  }

  registrationState[chatId] = { step: 1 };
  bot.sendMessage(chatId, "Please enter your full name:");
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;

  if (registrationState[chatId]?.step === 1) {
    const userName = msg.text;
    const phoneNumber = chatId.toString(); // Use chatId as phoneNumber for this example

    try {
      const user = await addUser(chatId, userName, phoneNumber);
      bot.sendMessage(
        chatId,
        `✓ Registration successful! Welcome, ${user.userName}.`
      );
      delete registrationState[chatId]; // Clean up the registration state
    } catch (error) {
      console.error("Error adding user:", error);
      bot.sendMessage(
        chatId,
        "There was an error during registration. Please try again."
      );
    }
  }
});

// Add user function
async function addUser(chatId, userName, phoneNumber) {
  let user = await User.findOne({ phoneNumber });
  if (!user) {
    user = new User({ userName, phoneNumber });
    await user.save();
  }
  return user;
}
// Ask for language selection
function askLanguageSelection(chatId) {
  bot.sendMessage(
    chatId,
    "ቋንቋ ይምረጡ||Mee afaan tokko filadhaa ||Please select a language || اختر لغة",
    {
      reply_markup: {
        keyboard: [["Arabic"], ["Amharic"], ["AfaanOromo"]],
        one_time_keyboard: true,
      },
    }
  );
}

// Handle language selection
function handleLanguageSelection(chatId, language) {
  console.log(language);
  userLanguages[chatId] = language;

  const categories = Object.keys(books[language]);
  if (categories.length === 0) {
    return bot.sendMessage(chatId, `No categories available for ${language}.`);
  }

  bot.sendMessage(
    chatId,
    `You selected ${language}. Please choose a category:`,
    {
      reply_markup: {
        keyboard: categories.map((cat) => [cat]),
        one_time_keyboard: true,
      },
    }
  );
}

// Handle category selection
// Handle category selection
function handleCategorySelection(chatId, category) {
  const userLanguage = userLanguages[chatId];
  if (!userLanguage) {
    return bot.sendMessage(
      chatId,
      `Please select a language first by typing /register.`
    );
  }

  const availableBooks = books[userLanguage][category].filter(
    (book) => book.available
  );

  if (availableBooks.length === 0) {
    return bot.sendMessage(
      chatId,
      `No books available in ${category} under ${userLanguage}.`
    );
  }

  // Always send the available books list
  const bookList = availableBooks
    .map((book) => `${book.id}. "${book.title}"`)
    .join("\n");

  bot.sendMessage(
    chatId,
    `Available books in ${category}:\n${bookList}\nYou can reserve a book by typing /reserve [book_id].`
  );
}

// Listen for category selection
bot.on("message", (msg) => {
  const chatId = msg.chat.id;

  if (registrationState[chatId]) {
    // ... existing registration handling
  } else if (["Arabic", "Amharic", "AfaanOromo"].includes(msg.text)) {
    handleLanguageSelection(chatId, msg.text);
  } else if (userLanguages[chatId]) {
    // Check if the message is a category selection
    if (Object.keys(books[userLanguages[chatId]]).includes(msg.text)) {
      handleCategorySelection(chatId, msg.text);
    } else {
      // If it's not a recognized category, let the user know
      // bot.sendMessage(
      //   chatId,
      //   `"${msg.text}" is not a valid category. Please select a category from the available options.`
      // );
    }
  } else if (msg.text === "/change_language") {
    askLanguageSelection(chatId);
  }
});

// Handle change language command
bot.onText(/\/change_language/, (msg) => {
  const chatId = msg.chat.id;
  askLanguageSelection(chatId);
});
bot.onText(/\/back_to_menu/, (msg) => {
  const chatId = msg.chat.id;
  askLanguageSelection(chatId);
});

// Ask for language selection
// function askLanguageSelection(chatId) {
//   bot.sendMessage(chatId, "Please select a language:", {
//     reply_markup: {
//       keyboard: [["Arabic"], ["Amharic"], ["AfaanOromo"]],
//       one_time_keyboard: true,
//     },
//   });
// }

// // Handle language selection
// function handleLanguageSelection(chatId, language) {
//   userLanguages[chatId] = language;

//   const categories = Object.keys(books[language]);
//   if (categories.length === 0) {
//     return bot.sendMessage(chatId, `No categories available for ${language}.`);
//   }

//   bot.sendMessage(
//     chatId,
//     `You selected ${language}. Please choose a category:`,
//     {
//       reply_markup: {
//         keyboard: categories.map((cat) => [cat]),
//         one_time_keyboard: true,
//       },
//     }
//   );
// }

// Listen for category selection
bot.on("message", (msg) => {
  const chatId = msg.chat.id;

  if (registrationState[chatId]) {
    // ... existing registration handling
  } else if (["Arabic", "Amharic", "AfaanOromo"].includes(msg.text)) {
    handleLanguageSelection(chatId, msg.text);
  } else if (userLanguages[chatId]) {
    // Check for category selection
    if (Object.keys(books[userLanguages[chatId]]).includes(msg.text)) {
      handleCategorySelection(chatId, msg.text);
    }
  } else if (msg.text === "/change_language") {
    askLanguageSelection(chatId);
  }
});

// Load books when the application starts
loadBooks();

bot.onText(/\/add_books (\d+) (\w+) "(.+)" "(.+)"/, async (msg, match) => {
  const chatId = msg.chat.id;
  const id = parseInt(match[1], 10);
  const language = match[2].trim();
  const category = match[3].trim();
  const title = match[4].trim();

  // Assuming books is a predefined object with languages and categories
  if (!books[language]) {
    return bot.sendMessage(chatId, `Language "${language}" does not exist.`);
  }

  if (!books[language][category]) {
    return bot.sendMessage(
      chatId,
      `Category "${category}" does not exist in "${language}".`
    );
  }

  const existingBook = await Book.findOne({ id });
  if (existingBook) {
    return bot.sendMessage(chatId, `A book with ID ${id} already exists.`);
  }

  const newBook = new Book({ id, title, available: true, language, category });
  await newBook.save();

  return bot.sendMessage(chatId, `Book "${title}" added successfully.`);
});
bot.onText(/\/remove_book (\w+) (\w+) (\d+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const language = match[1].trim();
  const category = match[2].trim();
  const id = parseInt(match[3], 10);

  if (!books[language]) {
    return bot.sendMessage(chatId, `Language "${language}" does not exist.`);
  }

  if (!books[language][category]) {
    return bot.sendMessage(
      chatId,
      `Category "${category}" does not exist in "${language}".`
    );
  }

  const bookIndex = books[language][category].findIndex(
    (book) => book.id === id
  );
  if (bookIndex === -1) {
    return bot.sendMessage(
      chatId,
      `No book found with ID ${id} in category "${category}".`
    );
  }

  books[language][category].splice(bookIndex, 1);
  saveBooks(); // Save the updated books object

  bot.sendMessage(
    chatId,
    `Book with ID ${id} has been removed from category "${category}" in ${language}.`
  );
});

// Reserve a book
// Reserve a book
bot.onText(/\/reserve (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const bookId = match[1];

  const user = await User.findOne({ phoneNumber: chatId });
  if (!user) {
    return bot.sendMessage(
      chatId,
      "You need to register first using /register."
    );
  }

  const book = await Book.findOne({ id: bookId });
  if (!book || !book.available) {
    return bot.sendMessage(
      chatId,
      `Sorry, the book with ID ${bookId} is not available.`
    );
  }

  const reservation = new Reservation({
    userId: user._id,
    bookId: book._id,
    pickupTime: "after isha salah",
  });

  await reservation.save();
  book.available = false; // Mark the book as reserved
  await book.save();

  return bot.sendMessage(
    chatId,
    `Successfully reserved: "${book.title}". Pickup time: after isha salah.`
  );
});

// View own reservations

bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  const helpMessage = `
Welcome to the Library Booking Bot!

### Commands
- **/start**: Start the bot and view the welcome message.
- **/register**: Register your name and phone number.
- **/my_reservations**: View your current reservations.
- **/change_language**: Change your selected language.
- **/help**: Get assistance with commands.
- **/exit**: Exit the bot.
  `;
  bot.sendMessage(chatId, helpMessage);
});

bot.onText(/\/my_reservations/, (msg) => {
  const chatId = msg.chat.id;
  let userReservations = reservations[chatId];

  // Ensure it's an array
  if (!Array.isArray(userReservations)) {
    userReservations = []; // Default to an empty array if it's not
  }

  if (userReservations.length === 0) {
    return bot.sendMessage(chatId, "You currently have no reservations.");
  }

  // Process and display reservations
  let cancelBookMessage = "❌ To cancel, use: /cancel_reservation [book_no]";
  let responseMessage = "➡️ Your reservations (use the number to cancel):\n";
  userReservations.forEach((reservation, index) => {
    responseMessage += `${index + 1}. 📚 "${
      reservation.title
    }" - Pickup time: ${reservation.pickupTime}, Phone: ${
      reservation.phoneNumber
    }\n`; // Include pickup time and phone number
  });
  bot.sendMessage(chatId, `${responseMessage}\n${cancelBookMessage}`);
});

// Cancel a reservation by ID
bot.onText(/\/cancel_reservation (\d+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const userReservationIndex = parseInt(match[1], 10) - 1; // Convert to 0-based index
  console.log("User Reservations:", reservations[chatId]);
  console.log("User Reservation Index:", userReservationIndex);

  // Check if the user has any reservations and if the index is valid
  if (
    !reservations[chatId] ||
    userReservationIndex < 0 ||
    userReservationIndex >= reservations[chatId].length
  ) {
    return bot.sendMessage(
      chatId,
      "Invalid reservation ID. Please check your reservations and try again."
    );
  }

  const canceledReservation = reservations[chatId][userReservationIndex];

  // Log the canceledReservation for debugging
  console.log("Canceled Reservation:", canceledReservation);

  if (!canceledReservation || !canceledReservation.bookId) {
    return bot.sendMessage(
      chatId,
      "Invalid reservation data. Please try again."
    );
  }

  const userLanguage = userLanguages[chatId];
  const book = findBookById(userLanguage, canceledReservation.bookId);

  if (book) {
    book.available = true; // Mark the book as available again
  }

  reservations[chatId].splice(userReservationIndex, 1); // Remove the reservation
  saveReservations(); // Save changes

  bot.sendMessage(
    chatId,
    `You have successfully canceled the reservation for "${canceledReservation.title}".`
  );

  notifyLibrarian(
    `User "${users[chatId].userName}" canceled reservation for "${canceledReservation.title}".`
  );
});
// Cancel a reservation by user and book ID
bot.onText(/\/librarian_cancel_reservation (\d+) (.+)/, (msg, match) => {
  const chatId = msg.chat.id; // ID of the librarian's chat
  const bookId = match[1]; // Extracted book ID
  const userName = match[2].trim(); // Extracted username

  // Find the user based on the username
  const userChatId = Object.keys(users).find(
    (id) => users[id].userName.trim().toLowerCase() === userName.toLowerCase()
  );

  if (!userChatId || !reservations[userChatId]) {
    return bot.sendMessage(
      chatId,
      `User "${userName}" not found or has no reservations.`
    );
  }

  // Find the reservation index for the specified book ID
  const reservationIndex = reservations[userChatId].findIndex(
    (reservation) => reservation.bookId === bookId
  );

  if (reservationIndex === -1) {
    return bot.sendMessage(
      chatId,
      `No reservation found for book ID ${bookId} for user "${userName}".`
    );
  }

  const canceledReservation = reservations[userChatId][reservationIndex];
  const userLanguage = userLanguages[userChatId];
  const book = findBookById(userLanguage, canceledReservation.bookId);

  if (book) {
    book.available = true; // Mark the book as available again
  }

  // Remove the reservation
  reservations[userChatId].splice(reservationIndex, 1);
  saveReservations(); // Save changes

  bot.sendMessage(
    chatId,
    `You have successfully canceled the reservation for "${canceledReservation.title}" for user "${userName}".`
  );

  notifyLibrarian(
    `Librarian canceled reservation for "${canceledReservation.title}" for user "${userName}".`
  );
});

bot.onText(/\/librarian_reserve (\d+) (.+) (.+)/, (msg, match) => {
  const chatId = msg.chat.id; // ID of the librarian's chat
  const bookId = match[1]; // Extracted book ID
  const userName = match[2].trim(); // Extracted username
  const phoneNumber = match[3].trim(); // Extracted phone number

  console.log(
    `Librarian ${chatId} is attempting to reserve book ID: ${bookId} for user: ${userName}, Phone: ${phoneNumber}`
  );

  // Find the book by ID across all languages and categories
  let reservedBook = null;
  for (const language in books) {
    for (const category in books[language]) {
      reservedBook = books[language][category].find(
        (book) => book.id == parseInt(bookId, 10)
      );
      if (reservedBook) break; // Break if book is found
    }
    if (reservedBook) break; // Break if book is found
  }

  // Check if the book was found
  if (!reservedBook) {
    console.log(`Book with ID ${bookId} not found.`);
    return bot.sendMessage(chatId, `Book not available or does not exist.`);
  }

  // Ensure the librarian is the one reserving the book
  if (chatId !== librarianChatId) {
    return bot.sendMessage(
      chatId,
      `You do not have permission to reserve books.`
    );
  }

  // Check if the book is already reserved
  if (!reservedBook.available) {
    console.log(`The book "${reservedBook.title}" is already reserved.`);
    return bot.sendMessage(
      chatId,
      `The book "${reservedBook.title}" is already reserved.`
    );
  }

  // Find or create the user entry
  let userChatId = Object.keys(users).find(
    (id) => users[id].userName.trim().toLowerCase() === userName.toLowerCase()
  );

  if (!userChatId) {
    // Create a new user entry if not found
    userChatId = chatId; // Use librarian's chat ID for logging
    users[userChatId] = {
      userName: userName,
      phoneNumber: phoneNumber,
    };
    console.log(`New user created: ${userName} with phone: ${phoneNumber}`);
  } else {
    // Update the phone number if user already exists
    users[userChatId].phoneNumber = phoneNumber;
    console.log(`Updated phone number for user: ${userName}`);
  }

  // Initialize reservations for the user if not already present
  if (!Array.isArray(reservations[userChatId])) {
    reservations[userChatId] = [];
  }

  // Add reservation details
  reservations[userChatId].push({
    bookId: reservedBook.id,
    title: reservedBook.title,
    userName: users[userChatId].userName,
    phoneNumber: phoneNumber, // Ensure phone number is stored
    pickupTime: "after isha salah",
  });

  // Mark the book as reserved
  reservedBook.available = false;

  // Save updated reservations and handle potential errors
  try {
    saveReservations();
    console.log(`Reservations saved successfully.`);
  } catch (error) {
    console.error(`Error saving reservations: ${error.message}`);
    return bot.sendMessage(
      chatId,
      `An error occurred while saving reservations.`
    );
  }

  // Notify both librarian and user
  bot.sendMessage(
    librarianChatId,
    `Librarian reserved "${reservedBook.title}" for "${users[userChatId].userName}".`
  );
  bot.sendMessage(
    userChatId,
    `You have reserved "${reservedBook.title}" by librarian. Phone: ${phoneNumber}`
  );
  console.log(`Reservation successful for book: ${reservedBook.title}`);
});
// View all reserved books
bot.onText(/\/reserved_books/, (msg) => {
  const chatId = msg.chat.id.toString();
  const librarianChatIdStr = librarianChatId.toString().trim();

  // Check if the user is the librarian
  if (chatId !== librarianChatIdStr) {
    return bot.sendMessage(
      chatId,
      `You do not have permission to view reserved books.`
    );
  }

  const allReservations = Object.entries(reservations);
  if (allReservations.length === 0) {
    return bot.sendMessage(chatId, `No valid reservations found.`);
  }

  const reservedList = allReservations
    .map(([userId, userReservations]) => {
      const user = users[userId];

      // Ensure userReservations is an array
      if (!Array.isArray(userReservations)) {
        console.error(
          `Expected userReservations to be an array, but got:`,
          userReservations
        );
        return null; // Handle the case where it's not an array
      }

      // Format reservations for each user
      return userReservations.map((reservation) => {
        return `Name: ${user.userName}, Reserved Book: "${reservation.title}", Phone Number: ${user.phoneNumber}`;
      });
    })
    .flat()
    .filter((item) => item !== null);

  // Check if we have any valid reservations to display
  if (reservedList.length === 0) {
    return bot.sendMessage(chatId, `No valid reservations found.`);
  }

  // Send the list of reserved books
  bot.sendMessage(chatId, `Reserved Books:\n${reservedList.join("\n")}`);
});

// Helper function to notify the librarian
function notifyLibrarian(message) {
  bot.sendMessage(librarianChatId, message);
}

// Error handling for polling
bot.on("polling_error", (error) => {
  console.error("Polling error:", error);
});

bot.on("error", (error) => {
  console.error("Error occurred:", error);
});

// Set the webhook URL
const setWebhook = async () => {
  const url = `https://librarybot-qx3c.onrender.com/webhook`; // Replace with your actual URL
  await bot.setWebHook(url);
};

app.post("/webhook", (req, res) => {
  console.log("Webhook received:", req.body); // Log incoming updates
  bot.processUpdate(req.body);
  res.sendStatus(200); // Respond with a 200 OK
});

setWebhook().catch(console.error);

// Start the Express server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
