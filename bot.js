const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const path = require("path");
const express = require("express");
require("dotenv").config();

const app = express();
app.use(express.json());
const port = process.env.PORT || 5000;

// Replace with your bot's API token
const token = process.env.TOKEN; // Update with your token
const bot = new TelegramBot(token); // No polling
const librarianChatId = process.env.LIBRARIAN_CHAT_ID.trim(); // Set this to the logged chat ID

// Book categories and reservations
let books = {
  Arabic: { Philosophy: [], Architecture: [] },
  Amharic: { Philosophy: [], Architecture: [] },
  AfaanOromo: { Philosophy: [], Architecture: [] },
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

function saveBooks() {
  fs.writeFileSync(booksFilePath, JSON.stringify(books, null, 2));
}

function saveReservations() {
  fs.writeFileSync(reservationsFilePath, JSON.stringify(reservations, null, 2));
}

function findBookById(language, bookId) {
  for (const category in books[language]) {
    const book = books[language][category].find((b) => b.id === bookId);
    if (book) return book;
  }
  return null;
}

// === Initialize Data ===
books = loadBooks();
reservations = loadReservations();

// Start command
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const welcomeMessage = `
Welcome to the Library Booking Bot!

As a librarian, you can manage book reservations.
Please register to get started by typing /register.

Available commands:
- /register: Register your name and phone number.
- /my_reservations: View your current reservations.
- /cancel_reservation [id]: Cancel your reservation by ID.
- /reserved_books: View all reserved books (librarian only).
- /add_books [language, category, title]: Add new books (librarian only).
- /reserve [book_id]: Reserve a book by its ID.
- /help: Show this help message again.
  `;
  bot.sendMessage(chatId, welcomeMessage);
});

// Registration logic
let registrationState = {};

bot.onText(/\/register/, (msg) => {
  const chatId = msg.chat.id;

  if (users[chatId]) {
    return bot.sendMessage(
      chatId,
      `You are already registered as ${users[chatId].userName}.`
    );
  }

  registrationState[chatId] = { step: 1 };
  bot.sendMessage(chatId, "Please enter your full name:");
});

// Handle user responses based on registration state
bot.on("message", (msg) => {
  const chatId = msg.chat.id;

  if (registrationState[chatId]) {
    const state = registrationState[chatId];

    if (state.step === 1) {
      state.userName = msg.text;
      state.step = 2;
      bot.sendMessage(chatId, "Please enter your phone number (numbers only):");
    } else if (state.step === 2) {
      const phoneNumber = msg.text;

      // Validate phone number
      if (!/^[0-9]+$/.test(phoneNumber)) {
        return bot.sendMessage(
          chatId,
          "Please enter a valid phone number (numbers only)."
        );
      }

      const existingUser = Object.values(users).find(
        (user) => user.phoneNumber === phoneNumber
      );
      if (existingUser) {
        delete registrationState[chatId];
        return bot.sendMessage(
          chatId,
          `This phone number is already registered by ${existingUser.userName}.`
        );
      }

      // Save user data
      users[chatId] = { userName: state.userName, phoneNumber };
      delete registrationState[chatId];

      bot.sendMessage(
        chatId,
        `Registration successful! Welcome, ${state.userName}.`
      );

      // Notify the librarian about the new registration
      notifyLibrarian(
        `New user registered: ${state.userName}, Phone: ${phoneNumber}`
      );

      // Ask for language selection
      askLanguageSelection(chatId);
    }
  } else if (["Arabic", "Amharic", "AfaanOromo"].includes(msg.text)) {
    handleLanguageSelection(chatId, msg.text);
  } else if (msg.text === "/change_language") {
    askLanguageSelection(chatId);
  }
});

// Ask for language selection
function askLanguageSelection(chatId) {
  bot.sendMessage(chatId, "Please select a language:", {
    reply_markup: {
      keyboard: [["Arabic"], ["Amharic"], ["AfaanOromo"]],
      one_time_keyboard: true,
    },
  });
}

// Handle language selection
function handleLanguageSelection(chatId, language) {
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

// Handle category selection and book listing
function handleCategorySelection(chatId, category) {
  const userLanguage = userLanguages[chatId];

  if (!userLanguage) {
    return bot.sendMessage(
      chatId,
      `Please select a language first by typing /register.`
    );
  }

  if (!books[userLanguage] || !books[userLanguage][category]) {
    return bot.sendMessage(
      chatId,
      `Category "${category}" does not exist under ${userLanguage}.`
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

  const bookList = availableBooks
    .map((book) => `${book.id}. ${book.title}`)
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
      bot.sendMessage(
        chatId,
        `"${msg.text}" is not a valid category. Please select a category from the available options.`
      );
    }
  } else if (msg.text === "/change_language") {
    askLanguageSelection(chatId);
  }
});

// Add multiple books
bot.onText(/\/add_books (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const booksInput = match[1].trim().split(";");

  booksInput.forEach((bookEntry) => {
    const [language, category, bookTitle] = bookEntry
      .trim()
      .split(",")
      .map((s) => s.trim());

    if (!books[language]) {
      return bot.sendMessage(chatId, `Language "${language}" does not exist.`);
    }

    if (!books[language][category]) {
      books[language][category] = [];
    }

    const newBookId = (books[language][category].length + 1)
      .toString()
      .padStart(3, "0");
    books[language][category].push({
      id: newBookId,
      title: bookTitle,
      available: true,
    });

    bot.sendMessage(
      chatId,
      `Added "${bookTitle}" to "${category}" in "${language}".`
    );
  });

  saveBooks();
});

// Reserve a book
bot.onText(/\/reserve (\d+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const bookId = match[1];
  const userLanguage = userLanguages[chatId];

  if (!userLanguage) {
    return bot.sendMessage(chatId, "Select a language first using /register.");
  }

  const book = findBookById(userLanguage, bookId);
  if (!book || !book.available) {
    return bot.sendMessage(chatId, "Book not available.");
  }

  // Ensure reservations[chatId] is initialized as an array
  if (!Array.isArray(reservations[chatId])) {
    reservations[chatId] = []; // Initialize if not an array
  }

  // Add the reservation
  reservations[chatId].push({
    bookId: book.id,
    title: book.title,
  });

  // Mark the book as unavailable
  book.available = false;

  // Save the updated books and reservations
  saveBooks();
  saveReservations();

  bot.sendMessage(chatId, `You reserved "${book.title}".`);

  // Notify the librarian about the reservation
  notifyLibrarian(`User "${users[chatId].userName}" reserved "${book.title}".`);
});

// View own reservations
// View own reservations
bot.onText(/\/my_reservations/, (msg) => {
  const chatId = msg.chat.id;
  let userReservations = reservations[chatId] || []; // Ensure it's an array

  if (userReservations.length === 0) {
    return bot.sendMessage(chatId, "You currently have no reservations.");
  }

  // Process and display reservations
  let responseMessage = "Your reservations (use the number to cancel):\n";
  userReservations.forEach((reservation, index) => {
    responseMessage += `${index + 1}. ${reservation.title}\n`; // 1-based index
  });

  bot.sendMessage(chatId, responseMessage);
});

// Cancel a reservation by ID
// Cancel a reservation by ID
// Cancel a reservation by ID
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

// Librarian command to reserve a book
bot.onText(/\/librarian_reserve (\d+) (.+) (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const bookId = match[1];
  const userName = match[2].trim();
  const phoneNumber = match[3].trim();

  let reservedBook;
  for (const language in books) {
    for (const category in books[language]) {
      reservedBook = books[language][category].find(
        (book) => book.id === bookId
      );
      if (reservedBook) break;
    }
    if (reservedBook) break;
  }

  if (!reservedBook) {
    return bot.sendMessage(chatId, `Book not available or does not exist.`);
  }

  // Check if the user is already registered
  let userChatId = Object.keys(users).find(
    (id) => users[id].userName.trim().toLowerCase() === userName.toLowerCase()
  );

  // If user is not found, create a new entry
  if (!userChatId) {
    userChatId = chatId; // Use the librarian's chat ID or generate a new one
    users[userChatId] = {
      userName: userName,
      phoneNumber: phoneNumber,
    };
  }

  // Initialize user's reservations if not present
  if (!reservations[userChatId]) {
    reservations[userChatId] = [];
  }

  // Add the reservation
  reservations[userChatId].push({
    bookId: reservedBook.id,
    title: reservedBook.title,
    userName: users[userChatId].userName,
    phoneNumber: phoneNumber,
    pickupTime: "after isha salah",
  });

  reservedBook.available = false; // Mark book as reserved

  saveReservations();

  bot.sendMessage(
    librarianChatId,
    `Librarian reserved "${reservedBook.title}" for "${users[userChatId].userName}".`
  );
  bot.sendMessage(
    userChatId,
    `You have reserved "${reservedBook.title}" by librarian.`
  );
});

// View all reserved books
bot.onText(/\/reserved_books/, (msg) => {
  const chatId = msg.chat.id.toString();
  const librarianChatIdStr = librarianChatId.toString().trim();

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

      return userReservations
        .map((reservation) => {
          return `Name: ${user.userName}, Reserved Book: ${reservation.title}, Phone Number: ${reservation.phoneNumber}`;
        })
        .join("\n");
    })
    .flat()
    .filter((item) => item !== null);

  if (reservedList.length === 0) {
    return bot.sendMessage(chatId, `No valid reservations found.`);
  }

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
