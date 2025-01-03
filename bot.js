const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const mongoose = require("mongoose");
require("dotenv").config();
const { User, Book, Reservation } = require("./models");

const app = express();
app.use(express.json());
const port = process.env.PORT || 5000;

// Replace with your bot's API token
const token = process.env.TOKEN;
const bot = new TelegramBot(token);
const librarianChatId = process.env.LIBRARIAN_CHAT_ID.trim();

// Database connection
async function connectToDatabase() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("MongoDB connected!");
  } catch (error) {
    console.error("MongoDB connection error:", error);
    setTimeout(connectToDatabase, 5000);
  }
}

// Initialize database connection
connectToDatabase();

const validCommands = [
  "/start",
  "/register",
  "/help",
  "/change_language",
  "/select_language",
  "/reserve", // This command requires an ID
  "/back",
  "/my_reservations",
  "/cancel_reservation", // This command requires a reservation number
  "/add_books",
  "/view_reservations",
  "/librarian_add_reservation",
  "/librarian_cancel_reservation",
  "/remove_book",
  // Add other commands as needed
];

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  console.log(`Received message from ${chatId}: ${msg.text}`);

  try {
    // Handle commands
    if (msg.text.startsWith("/")) {
      // Check if it's a valid command
      if (!validCommands.includes(msg.text.split(" ")[0])) {
        return bot.sendMessage(
          chatId,
          "❌ Invalid command. Please type /help for the list of available commands."
        );
      }

      // Special handling for commands that require parameters
      if (msg.text.startsWith("/reserve")) {
        const bookId = msg.text.split(" ")[1];
        if (!bookId) {
          return bot.sendMessage(
            chatId,
            "❌ Please provide a book ID to reserve."
          );
        }
        // Call the centralized reservation handling function
        await handleReserveCommand(chatId, bookId);
      } else if (msg.text.startsWith("/cancel_reservation")) {
        const reservationId = msg.text.split(" ")[1];
        if (!reservationId) {
          return bot.sendMessage(
            chatId,
            "❌ Please provide a reservation ID to cancel."
          );
        }
        await handleCancelReservation(chatId, reservationId);
      }
    }

    // Continue checking for other commands or user states
    if (userStates[chatId]) {
      await handleRegistrationSteps(chatId, msg);
    } else if (["Arabic", "Amharic", "AfaanOromo"].includes(msg.text)) {
      return handleLanguageSelection(chatId, msg.text);
    } else if (msg.text === "/change_language") {
      return askLanguageSelection(chatId);
    }
  } catch (error) {
    await handleError(
      chatId,
      "⚠️ An unexpected error occurred. Please try again.",
      `Error handling message from ${chatId}: ${error.message}`
    );
  }
});

// Centralized reservation handling
async function handleReserveCommand(chatId, bookId) {
  try {
    const book = await Book.findOne({ id: bookId, available: true });
    if (!book) {
      return bot.sendMessage(
        chatId,
        "❌ Invalid book ID or the book is not available."
      );
    }

    const user = await User.findOne({ chatId });
    if (!user) {
      return bot.sendMessage(
        chatId,
        "🚫 You need to register first using /register."
      );
    }

    const reservation = new Reservation({
      userId: user._id,
      bookId: book._id,
      pickupTime: "after isha salah",
    });
    await reservation.save();

    book.available = false; // Mark the book as unavailable
    await book.save();

    const notificationMessage = `🆕 New reservation by *${user.userName}* (Phone: *${user.phoneNumber}*) for *"${book.title}"*.`;
    await notifyLibrarian(notificationMessage);

    await bot.sendMessage(
      chatId,
      `✅ Successfully reserved: *"${book.title}"*.\nPickup time: *after isha salah*.\n\nTo go back to the menu, type /back.`,
      { parse_mode: "Markdown" }
    );
  } catch (error) {
    console.error("Error reserving book:", error);
    await handleError(
      chatId,
      "⚠️ There was an error processing your reservation. Please try again.",
      `Error saving reservation: ${error.message}`
    );
  }
}

// Centralized cancellation handling
async function handleCancelReservation(chatId, reservationIndex) {
  try {
    const user = await User.findOne({ chatId });
    if (!user) {
      return bot.sendMessage(
        chatId,
        "🚫 You need to register first using /register."
      );
    }

    const userReservations = await Reservation.find({
      userId: user._id,
    }).populate("bookId");

    if (reservationIndex < 0 || reservationIndex >= userReservations.length) {
      return bot.sendMessage(
        chatId,
        "❌ Invalid reservation number. Please check your reservations and try again."
      );
    }

    const reservation = userReservations[reservationIndex];
    const book = await Book.findById(reservation.bookId);
    if (book) {
      book.available = true; // Mark the book as available again
      await book.save();
    }

    await Reservation.findByIdAndDelete(reservation._id);
    await bot.sendMessage(
      chatId,
      `✅ You have successfully canceled the reservation for *"${reservation.bookId.title}"*.`,
      { parse_mode: "Markdown" }
    );

    // Notify librarian
    const notificationMessage = `📩 User has canceled a reservation:\n- *Title:* *"${
      reservation.bookId.title
    }"*\n- *User ID:* *${user._id}*\n- *Name:* *${
      user.userName
    }*\n- *Phone:* *${user.phoneNumber}*\n- *Reservation Number:* *${
      reservationIndex + 1
    }*`;
    await notifyLibrarian(notificationMessage);
  } catch (error) {
    console.error("Error canceling reservation:", error);
    await handleError(
      chatId,
      "⚠️ An error occurred while canceling your reservation. Please try again.",
      `Error canceling reservation: ${error.message}`
    );
  }
}

// Command handler for canceling a reservation
bot.onText(/\/cancel_reservation (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const reservationIndex = parseInt(match[1]) - 1; // Convert to zero-based index
  console.log("Chat ID:", chatId); // Log the chat ID for debugging

  // Call the centralized cancellation handling function
  await handleCancelReservation(chatId, reservationIndex);
});

// Start command
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const welcomeMessage = `

          ❖◉◉◉◉◉❖◉◉◉◉◉◉❖◉◉◉◉◉◉❖
        اَلسَّلاَ مُ عَلَيْكُمْ وَرَحْمَةُ اللهِ وَبَرَكَاتُهُ
        
  🎉 *Welcome to the KJUMJ IRSHAD Library Booking Bot!* 📚
  
  Please choose an option below:

        ❖◉◉◉◉◉❖◉◉◉◉◉◉❖◉◉◉◉◉◉❖
  `;

  const options = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "📝 Register", callback_data: "register" },
          { text: "❓ Help", callback_data: "help" },
        ],
      ],
    },
  };

  bot.sendMessage(chatId, welcomeMessage, {
    parse_mode: "Markdown",
    ...options,
  });
});

// Registration state management
const userStates = {};

// Handle button callbacks for Register and Help
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;

  if (query.data === "register") {
    console.log(`User ${chatId} initiated registration.`);

    try {
      const existingUser = await User.findOne({ chatId });
      if (existingUser) {
        console.log(
          `User ${chatId} is already registered as ${existingUser.userName}.`
        );
        await bot.sendMessage(
          chatId,
          `🚫 You are already registered as *${existingUser.userName}*.`
        );
        return askLanguageSelection(chatId);
      }

      userStates[chatId] = { step: 1 };
      console.log(`User ${chatId} is at step 1: asking for full name.`);
      await bot.sendMessage(chatId, "📝 Please enter your full name:");
    } catch (error) {
      await handleError(
        chatId,
        "⚠️ An error occurred during registration. Please try again.",
        `Error during registration initiation: ${error.message}`
      );
    }
  } else if (query.data === "help") {
    const helpMessage = `
🤖 Library Bot Help

Here are the commands you can use:

➡️ 📋 /register: Register yourself to start using the library services.
   Example: /register

➡️ 🌐 /change_language: Change your preferred language.
   Example: /change_language

➡️ 📚 /select_category: Choose a category for books.

➡️ 📖 /reserve_book <book_id>: Reserve a specific book.
   Example: /reserve_book 112

➡️ 📝 /my_reservations: View your current reservations.
   Example: /my_reservations

➡️ ❌ /cancel_reservation <number>: Cancel a specific reservation by its number.
   Example: /cancel_reservation 1

For more questions, feel free to reach out to us via @IrshadComments_bot! 📩
`;
    await bot.sendMessage(chatId, helpMessage);
  }

  // Acknowledge the callback
  bot.answerCallbackQuery(query.id);
});

// Handle user input for registration
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;

  if (userStates[chatId] && userStates[chatId].step === 1) {
    console.log(`User ${chatId} provided full name: ${msg.text}`);
    try {
      const userName = msg.text; // Save the user's full name
      const newUser = new User({ chatId, userName }); // Create a new user in the database
      await newUser.save(); // Save the user to the database
      await bot.sendMessage(
        chatId,
        `✅ Registration successful! Welcome, *${userName}*!`
      );
      delete userStates[chatId]; // Clear the user state
    } catch (error) {
      await handleError(
        chatId,
        "⚠️ An error occurred while saving your registration. Please try again.",
        `Error during registration saving: ${error.message}`
      );
    }
  }
});
// Notify librarian
async function notifyLibrarian(message) {
  await bot.sendMessage(librarianChatId, message);
}

async function handleUnexpectedMessage(chatId, message) {
  const isCommand = message.startsWith("/") && validCommands.includes(message);
  const isLanguage = ["Arabic", "Amharic", "AfaanOromo"].includes(message);

  // If it's not a command or a recognized language, provide feedback
  if (!isCommand && !isLanguage) {
    await bot.sendMessage(
      chatId,
      "❓ I didn't understand that. Please type /help to see available commands."
    );
  }
}
async function handleRegistrationSteps(chatId, msg) {
  if (userStates[chatId].step === 1) {
    userStates[chatId].userName = msg.text;
    userStates[chatId].step = 2;
    console.log(`User ${chatId} provided full name: ${msg.text}`);
    return bot.sendMessage(
      chatId,
      "📞 Please enter your phone number (must start with 09 and be 10 digits long):"
    );
  } else if (userStates[chatId].step === 2) {
    return await processPhoneNumber(chatId, msg.text);
  }
}

async function processPhoneNumber(chatId, phoneNumber) {
  console.log(`User ${chatId} provided phone number: ${phoneNumber}`);
  const phoneRegex = /^09\d{8}$/;

  if (!phoneRegex.test(phoneNumber)) {
    return bot.sendMessage(
      chatId,
      "❌ Invalid phone number. Please enter a valid phone number starting with 09 and consisting of 10 digits."
    );
  }

  const user = await addUser(chatId, userStates[chatId].userName, phoneNumber);
  console.log(
    `User ${chatId} registered with name: ${user.userName}, phone: ${phoneNumber}`
  );

  await notifyLibrarian(
    `🆕 New registration: *${user.userName}*,\n Phone: *${phoneNumber}*`
  );
  await bot.sendMessage(
    chatId,
    `✓ Registration successful! Welcome, *${user.userName}*! 🎉`
  );
  delete userStates[chatId]; // Clear the registration state
  return askLanguageSelection(chatId);
}

// Ask for language selection
function askLanguageSelection(chatId) {
  bot.sendMessage(chatId, "🌐 Please select a language:", {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🇸🇩 Arabic", callback_data: "Arabic" },
          { text: "🇪🇹 Amharic", callback_data: "Amharic" },
        ],
        [{ text: "🇪🇹 Afaan Oromoo", callback_data: "AfaanOromo" }],
      ],
    },
  });
}

bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const language = query.data;

  // Handle language selection
  await handleLanguageSelection(chatId, language);

  // Remove the inline keyboard and update the message
  await bot.editMessageText(`🌐 You have selected *${language}*. Thank you!`, {
    chat_id: chatId,
    message_id: query.message.message_id,
    parse_mode: "Markdown",
  });

  bot.answerCallbackQuery(query.id); // Acknowledge the callback
});

async function addUser(chatId, userName, phoneNumber) {
  let user = await User.findOne({ phoneNumber });
  if (!user) {
    user = new User({ userName, phoneNumber, chatId }); // Ensure chatId is included
    await user.save();
    console.log(
      `New user created: ${user.userName}, Phone: ${phoneNumber}, Chat ID: ${chatId}`
    );
  } else {
    console.log(
      `User with phone number ${phoneNumber} already exists. Returning existing user.`
    );
  }
  return user;
}

// Handle language selection

async function handleLanguageSelection(chatId, language) {
  const categories = await Book.distinct("category", { language });

  if (categories.length > 0) {
    const inlineButtons = categories.map((cat) => [
      { text: `📚 ${cat}`, callback_data: cat }, // Add a book icon to each category
    ]);

    const message = await bot.sendMessage(
      chatId,
      `🌐 You selected *${language}*. Please choose a category:`,
      {
        reply_markup: {
          inline_keyboard: inlineButtons,
        },
      }
    );

    return message; // Return the message object for later use
  }
  // If no categories found, simply do nothing (no message sent)
}

// Handle category selection and list books
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const selectedCategory = query.data;

  // Remove the inline keyboard and update the previous message
  await bot.editMessageText(
    `📚 You selected the category: *${selectedCategory}*. Loading available books...`,
    {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: "Markdown",
    }
  );

  const books = await Book.find({
    category: selectedCategory,
    available: true,
  });

  if (books.length > 0) {
    const bookList = books
      .map((book) => `🔖 *ID:* *${book.id}* - *"${book.title}"*`)
      .join("\n");

    await bot.sendMessage(
      chatId,
      `📖 *Available books in* *"${selectedCategory}"*:\n\n${bookList}\n\nTo reserve a book, type /reserve <ID>.`,
      { parse_mode: "Markdown" }
    );
  }
  // If no available books, simply do nothing (no message sent)
});

// Example for category selection
// if (userStates[chatId] && userStates[chatId].awaitingCategory) {
//   return bot.sendMessage(
//     chatId,
//     "⚠️ Please select a category using the inline keyboard."
//   );
// }
// Function to check if the message is a valid category
async function isCategory(category) {
  const categories = await Book.distinct("category");
  return categories.includes(category);
}
bot.onText(/\/select_language/, (msg) => {
  const chatId = msg.chat.id;
  askLanguageSelection(chatId);
});

// Reservation logic

bot.onText(/\/back/, (msg) => {
  const chatId = msg.chat.id;
  askLanguageSelection(chatId); // Call the function to ask for language selection
});
bot.onText(/\/add_books (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;

  // Check if the user is a librarian
  if (!isLibrarian(chatId)) {
    return bot.sendMessage(
      chatId,
      "🚫 You do not have permission to add books."
    );
  }

  const entries = match[1].split(";").map((entry) => entry.trim());

  for (const entry of entries) {
    const parts = entry.match(/^(\d+) (.+) "(.+)" "(.+)"$/); // Updated regex to allow any language
    if (!parts) {
      await bot.sendMessage(
        chatId,
        `❌ Invalid format for entry: *"${entry}".*`,
        { parse_mode: "Markdown" }
      );
      continue;
    }

    const id = parseInt(parts[1], 10);
    const language = parts[2].trim();
    const category = parts[3].trim();
    const title = parts[4].trim();

    const existingBook = await Book.findOne({ id });
    if (existingBook) {
      await bot.sendMessage(
        chatId,
        `🚫 A book with ID *${id}* already exists.`
      );
      continue;
    }

    const newBook = new Book({
      id,
      title,
      available: true,
      language,
      category,
    });
    await newBook.save();
    await bot.sendMessage(chatId, `✅ Book *"${title}"* added successfully.`, {
      parse_mode: "Markdown",
    });
  }
});

bot.onText(/\/view_reservations/, async (msg) => {
  const chatId = msg.chat.id;

  if (!isLibrarian(chatId)) {
    return bot.sendMessage(
      chatId,
      "You do not have permission to use this command."
    );
  }

  const reservations = await Reservation.find().populate("userId bookId");
  if (reservations.length === 0) {
    return bot.sendMessage(chatId, "📅 There are no reservations.");
  }

  const reservationList = reservations
    .map(
      (res) =>
        `🔖 Book ID: *${res.bookId.id}* → User: *${res.userId.userName}* → Book: "${res.bookId.title}" → Pickup Time: *${res.pickupTime}*,`
    )
    .join("\n");

  bot.sendMessage(chatId, `📚 Current Reservations:\n\n${reservationList}`, {
    parse_mode: "Markdown",
  });
});
bot.onText(
  /\/librarian_add_reservation (\S+) (\d+) ?(.*)?/,
  async (msg, match) => {
    const chatId = msg.chat.id;

    // Check if the user is a librarian
    if (!isLibrarian(chatId)) {
      return bot.sendMessage(
        chatId,
        "🚫 You do not have permission to use this command."
      );
    }

    const userName = match[1]; // User name
    const bookId = match[2]; // Book ID (make sure this is numeric)
    const pickupTime = match[3] || "after isha salah"; // Optional pickup time

    // Check if the user is registered
    const user = await User.findOne({ userName });
    if (!user) {
      return bot.sendMessage(
        chatId,
        "👤 User not found. Registration is required before reserving a book."
      );
    }

    // Find the book by ID
    const book = await Book.findOne({ id: bookId });
    if (!book || !book.available) {
      return bot.sendMessage(
        chatId,
        `❌ Sorry, the book with ID *${bookId}* is not available.`,
        { parse_mode: "Markdown" }
      );
    }

    // Create the reservation
    const reservation = new Reservation({
      userId: user._id,
      bookId: book._id,
      pickupTime,
    });

    await reservation.save();
    book.available = false; // Mark the book as unavailable
    await book.save();

    await notifyLibrarian(
      `🆕 New manual reservation for *${user.userName}* for *"${book.title}"*.`
    );
    bot.sendMessage(
      chatId,
      `✅ Successfully added reservation for *${user.userName}* for *"${book.title}"*.`,
      { parse_mode: "Markdown" }
    );
  }
);

bot.onText(/\/librarian_cancel_reservation (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const bookId = match[1]; // This is the numeric ID of the book provided by the user

  if (!isLibrarian(chatId)) {
    return bot.sendMessage(
      chatId,
      "🚫 You do not have permission to use this command."
    );
  }

  console.log(`Received book ID: ${bookId}`);

  // Find the book by its numeric ID
  const book = await Book.findOne({ id: bookId });
  if (!book) {
    return bot.sendMessage(
      chatId,
      "❌ No book found with the given ID. Please check and try again."
    );
  }

  // Find the reservation using the book's ObjectId
  const reservation = await Reservation.findOne({ bookId: book._id }).populate(
    "userId"
  );
  if (!reservation) {
    return bot.sendMessage(
      chatId,
      "❌ No reservation found for the given book ID. Please check and try again."
    );
  }

  // Mark the book as available again
  book.available = true; // Mark the book as available again
  await book.save();

  // Delete the reservation
  await Reservation.findByIdAndDelete(reservation._id);

  // Ensure to correctly access the title of the book
  bot.sendMessage(
    chatId,
    `✅ Reservation for *"${book.title}"* has been successfully canceled.`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/change_language/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, "🌐 Please select a language:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "Arabic", callback_data: "Arabic" }],
        [{ text: "Amharic", callback_data: "Amharic" }],
        [{ text: "AfaanOromo", callback_data: "AfaanOromo" }],
      ],
    },
  });
});

// Handle language selection
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  if (["Arabic", "Amharic", "AfaanOromo"].includes(msg.text)) {
    // Assuming you have a user object to save the language preference
    const user = await User.findOne({ chatId });
    if (user) {
      user.language = msg.text; // Save the selected language
      await user.save();
      bot.sendMessage(chatId, `✅ Language changed to *${msg.text}*.`, {
        parse_mode: "Markdown",
      });
    }
  }
});
// bot.onText(/\/cancel_own_reservation (\d+)/, async (msg, match) => {
//   const chatId = msg.chat.id;
//   const reservationId = match[1];

//   const user = await User.findOne({ chatId });
//   if (!user) {
//     return bot.sendMessage(
//       chatId,
//       "You need to register first using /register."
//     );
//   }

//   const reservation = await Reservation.findOne({
//     _id: reservationId,
//     userId: user._id,
//   });
//   if (!reservation) {
//     return bot.sendMessage(
//       chatId,
//       "You do not have a reservation with that ID."
//     );
//   }

//   const book = await Book.findById(reservation.bookId);
//   if (book) {
//     book.available = true; // Mark the book as available
//     await book.save();
//   }

//   await Reservation.findByIdAndDelete(reservationId);
//   bot.sendMessage(
//     chatId,
//     `You have successfully canceled your reservation for "${book.title}".`
//   );
// });
// Remove book from the database
bot.onText(/\/remove_book (\w+) (.+) (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;

  // Debugging: Log the incoming message
  console.log(`Received message from ${chatId}: ${msg.text}`);

  // Log the match array
  console.log(`Match array: ${JSON.stringify(match)}`);

  // Check if the user is a librarian
  if (!isLibrarian(chatId)) {
    console.log(`User ${chatId} is not a librarian.`);
    return bot.sendMessage(
      chatId,
      "🚫 You do not have permission to remove books."
    );
  }

  // Check if match array is valid
  if (!match || match.length < 4) {
    console.log(`Invalid command syntax: ${msg.text}`);
    return bot.sendMessage(
      chatId,
      "❌ Invalid command syntax. Please use: /remove_book <language> <category> <id>."
    );
  }

  const language = match[1].trim();
  const category = match[2].trim();
  const id = parseInt(match[3], 10);

  // Debugging: Log the parameters
  console.log(
    `Attempting to remove book  Language: ${language}, Category: ${category}, ID: ${id}`
  );

  // Attempt to find and remove the book
  const book = await Book.findOneAndDelete({ id, language, category });
  if (!book) {
    console.log(`No book found with ID ${id} in category "${category}".`);
    return bot.sendMessage(
      chatId,
      `❌ No book found with ID *${id}* in category *"${category}".*`,
      { parse_mode: "Markdown" }
    );
  }

  console.log(
    `Book with ID ${id} has been removed from category "${category}".`
  );
  bot.sendMessage(
    chatId,
    `✅ Book with ID *${id}* has been removed from category *"${category}"* in *${language}*.`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/my_reservations/, async (msg) => {
  const chatId = msg.chat.id;
  const user = await User.findOne({ chatId });

  if (!user) {
    return bot.sendMessage(
      chatId,
      "🚫 You need to register first using /register."
    );
  }

  const userReservations = await Reservation.find({
    userId: user._id,
  }).populate("bookId");

  if (userReservations.length === 0) {
    return bot.sendMessage(chatId, "📭 You currently have no reservations.");
  }

  const reservationList = userReservations
    .map((res, index) => {
      // Escape all Markdown special characters
      const title = res.bookId.title.replace(/([_*~`>#+\-.!])/g, "\\$1");
      const pickupTime = res.pickupTime.replace(/([_*~`>#+\-.!])/g, "\\$1");
      return `📝 Reservation #${
        index + 1
      }:📙 ${title} ⌚ (Pickup: ${pickupTime})`;
    })
    .join("\n");

  // Log the final message for debugging
  console.log(
    "Final Message:",
    `📖 *Your Reservations:*\n${reservationList}\n\nTo cancel a reservation, use /cancel_reservation <number>.`
  );

  try {
    // Send message as plain text for testing
    await bot.sendMessage(
      chatId,
      `📖 Your Reservations:\n${reservationList}\n\nTo cancel a reservation, use /cancel_reservation <number>.`
    );
  } catch (error) {
    console.error("Error sending message:", error);
    await bot.sendMessage(
      chatId,
      "❌ An error occurred while retrieving your reservations. Please try again."
    );
  }
});

// Check if the user is a librarian
const isLibrarian = (chatId) => {
  return chatId == librarianChatId; // Compare with the librarian's chat ID
};

// Librarian can cancel a reservation
bot.onText(/\/librarian_cancel_reservation (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const bookId = match[1]; // This is the numeric ID of the book provided by the user

  if (!isLibrarian(chatId)) {
    return bot.sendMessage(
      chatId,
      "🚫 You do not have permission to use this command."
    );
  }

  // Find the book by its numeric ID
  const book = await Book.findOne({ id: bookId });
  if (!book) {
    return bot.sendMessage(
      chatId,
      "❌ No book found with the given ID. Please check and try again."
    );
  }

  // Find the reservation by book ID using the book's ObjectId
  const reservation = await Reservation.findOne({ bookId: book._id }).populate(
    "userId"
  );
  if (!reservation) {
    return bot.sendMessage(
      chatId,
      "❌ No reservation found for the given book ID. Please check and try again."
    );
  }

  // Mark the book as available again
  book.available = true;
  await book.save();

  // Delete the reservation
  await Reservation.findByIdAndDelete(reservation._id);
  bot.sendMessage(
    chatId,
    `✅ Reservation for *"${reservation.bookId.title}"* has been successfully canceled.`,
    { parse_mode: "Markdown" }
  );
});
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;

  const helpMessage = `
🤖 Library Bot Help

Here are the commands you can use:

➡️ 📋 /register: Register yourself to start using the library services.
   Example: /register

➡️ 🌐 /change_language: Change your preferred language.
   Example: /change_language

➡️ 📚 /select_category: Choose a category for books.

➡️ 📖 /reserve_book <book_id>: Reserve a specific book.
   Example: /reserve_book 112

➡️ 📝 /my_reservations: View your current reservations.
   Example: /my_reservations

➡️ ❌ /cancel_reservation <number>: Cancel a specific reservation by its number.
   Example: /cancel_reservation 1

For more questions, feel free to reach out to us via @IrshadComments_bot! 📩
`;

  bot.sendMessage(chatId, helpMessage);
});
// Start the Express server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

// Set the webhook URL
const setWebhook = async () => {
  const url = `https://librarybot-qx3c.onrender.com/webhook`;
  await bot.setWebHook(url);
};

app.post("/webhook", (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Set webhook on startup
setWebhook().catch(console.error);

// Error handling
bot.on("polling_error", (error) => {
  console.error("Polling error:", error);
});

bot.on("error", (error) => {
  console.error("Error occurred:", error);
});
