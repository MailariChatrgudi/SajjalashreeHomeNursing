// form.js

// Initialize EmailJS
(function () {
  emailjs.init("RpERYfZmnZX1yaCzT"); // 🔹 Replace with your EmailJS Public Key
})();

document.addEventListener("DOMContentLoaded", function () {
  // Select all forms
  const forms = document.querySelectorAll("form");

  forms.forEach((form) => {
    form.addEventListener("submit", function (e) {
      e.preventDefault();

      // Gather inputs dynamically
      const inputs = form.querySelectorAll("input, textarea, select");
      let formData = {};

      inputs.forEach((input) => {
        const key =
          input.getAttribute("name") ||
          input.getAttribute("id") ||
          "field_" + Math.random().toString(36).substring(7);
        formData[key] = input.value;
      });

      // Detect form type
      let templateID = "";
      /*if (form.closest("#career")) {
        templateID = "template_career"; // Career form
        formData.form_type = "Career Form";
        pass
      } else**/
      if (form.hasAttribute("data-product")) {
        templateID = "template_product_enquiry"; // Product enquiry
        formData.form_type = "Product Enquiry";
        formData.product_name = form.getAttribute("data-product");
      } /*else if (form.id === "popup-enquiry-form") {
        templateID = "template_callback"; // Popup enquiry
        formData.form_type = "Popup Enquiry";
      }*/ else  {
        templateID = "template_general_enquiry"; // General enquiry
        formData.form_type = "General Enquiry";
      }

      // Send email
      emailjs
        .send("service_h22bdzo", templateID, formData)
        .then(
          function () {
            alert("✅ Thank you! Your enquiry has been sent successfully.");
            form.reset();
          },
          function (error) {
            alert("❌ Oops! Failed to send. Please try again.");
            console.error("FAILED...", error);
          }
        );
    });
  });
});


window.onload = function() {
  setTimeout(function() {
    document.getElementById("enquiryPopup").style.display = "flex";
  },3000);
};

// Close popup
function closePopup() {
  document.getElementById("enquiryPopup").style.display = "none";
}




(function () {
  emailjs.init("RpERYfZmnZX1yaCzT"); // 🔹 Replace with your EmailJS Public Key
})();

document.addEventListener("DOMContentLoaded", function () {
  // Select all forms
  const forms = document.querySelectorAll("form");

  forms.forEach((form) => {
    form.addEventListener("submit", function (e) {
      e.preventDefault();

      // Gather inputs dynamically
      const inputs = form.querySelectorAll("input, textarea, select");
      let formData = {};

      inputs.forEach((input) => {
        const key =
          input.getAttribute("name") ||
          input.getAttribute("id") ||
          "field_" + Math.random().toString(36).substring(7);
        formData[key] = input.value;
      });

      // Detect form type
      let templateID = "";
      /*if (form.closest("#career")) {
        templateID = "template_career"; // Career form
        formData.form_type = "Career Form";
        pass
      } else**/
      if (form.hasAttribute("data-product")) {
        templateID = "template_product_enquiry"; // Product enquiry
        formData.form_type = "Product Enquiry";
        formData.product_name = form.getAttribute("data-product");
      } /*else if (form.id === "popup-enquiry-form") {
        templateID = "template_callback"; // Popup enquiry
        formData.form_type = "Popup Enquiry";
      }*/ else if (form.closest("#exampleModal")){
        templateID = "template_general_enquiry"; // General enquiry
        formData.form_type = "General Enquiry";
      }

      // Send email
      emailjs
        .send("service_h22bdzo", templateID, formData)
        .then(
          function () {
            alert("✅ Thank you! Your enquiry has been sent successfully.");
            form.reset();
          },
          function (error) {
            alert("❌ Oops! Failed to send. Please try again.");
            console.error("FAILED...", error);
          }
        );
    });
  });
});